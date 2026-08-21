const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const { signAccessToken, generateRefreshToken, hashRefreshToken, accessExpiresAtUnix, ACCESS_TTL_SECONDS } = require('./jwt.service');

const REFRESH_TTL_DAYS = parseInt(process.env.JWT_REFRESH_TTL_DAYS || '30', 10);
const BCRYPT_ROUNDS = 12;

function isDuplicateKeyError(err) {
  return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
}

async function findByPhone(phoneE164) {
  const rows = await query(
    'SELECT * FROM app_users WHERE phone_e164 = ? LIMIT 1',
    [phoneE164],
  );
  return rows[0] ?? null;
}

async function findById(id) {
  const rows = await query('SELECT * FROM app_users WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

async function findExistingProfileId(phoneE164, email) {
  const byMobile = await query(
    'SELECT id FROM profiles WHERE mobile = ? LIMIT 1',
    [phoneE164],
  );
  if (byMobile[0]?.id) return byMobile[0].id;

  const byEmail = await query(
    'SELECT id FROM profiles WHERE email = ? LIMIT 1',
    [email],
  );
  return byEmail[0]?.id ?? null;
}

async function insertAppUser({ phoneE164, email, password_hash, id }) {
  const userId = id ?? randomUUID();
  await execute(
    `INSERT INTO app_users (id, phone_e164, email, password_hash)
     VALUES (?, ?, ?, ?)`,
    [userId, phoneE164, email, password_hash ?? null],
  );
  const rows = await query('SELECT * FROM app_users WHERE id = ? LIMIT 1', [userId]);
  return rows[0];
}

async function findOrCreateByPhone(phoneE164, email) {
  const existing = await findByPhone(phoneE164);
  if (existing) {
    return { user: existing, isNewUser: false };
  }

  // No app_users row matches this phone, but a profile for the same person may still exist —
  // matched by mobile or by the derived phone auth email. This happens for guardian-created
  // "shadow" elders, and for accounts whose app_users.phone_e164 has drifted from profiles.mobile
  // (e.g. a normalization mismatch, or a mobile added to the profile after a Google/email signup).
  const preservedId = await findExistingProfileId(phoneE164, email);

  if (preservedId) {
    // profiles.id is an FK onto app_users.id, so a found profile id almost always ALREADY has an
    // app_users row. Adopt it (and repair the phone drift that caused the lookup miss) instead of
    // inserting — an INSERT with this id would collide on the PRIMARY key (the bug this fixes).
    const existingById = await findById(preservedId);
    if (existingById) {
      if (existingById.phone_e164 !== phoneE164) {
        try {
          await execute('UPDATE app_users SET phone_e164 = ? WHERE id = ?', [phoneE164, preservedId]);
        } catch (err) {
          // Another account already owns this phone (unique key) — leave the row as-is rather than
          // failing the sign-in; the caller still gets a valid, existing account back.
          if (!isDuplicateKeyError(err)) throw err;
        }
      }
      const refreshed = await findById(preservedId);
      return { user: refreshed ?? existingById, isNewUser: false };
    }
  }

  try {
    const user = await insertAppUser({
      phoneE164,
      email,
      id: preservedId ?? undefined,
    });
    return { user, isNewUser: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // Lost a race (or drift we didn't catch above): recover by phone, then by the preserved id.
      const retry =
        (await findByPhone(phoneE164)) || (preservedId ? await findById(preservedId) : null);
      if (retry) return { user: retry, isNewUser: false };
    }
    throw err;
  }
}

async function storeRefreshToken(userId, refreshToken) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  const expiresAtStr = expiresAt.toISOString().slice(0, 19).replace('T', ' ');

  await execute(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, hashRefreshToken(refreshToken), expiresAtStr],
  );
}

async function issueSession(user) {
  const refresh_token = generateRefreshToken();
  await storeRefreshToken(user.id, refresh_token);

  return {
    access_token: signAccessToken(user),
    refresh_token,
    expires_in: ACCESS_TTL_SECONDS,
    expires_at: accessExpiresAtUnix(),
    token_type: 'bearer',
    user: {
      id:    user.id,
      email: user.email,
    },
  };
}

async function verifyPassword(user, password) {
  if (!user?.password_hash) return false;
  return bcrypt.compare(password, user.password_hash);
}

async function createUserWithPassword({ phoneE164, email, password }) {
  const existing = await findByPhone(phoneE164);
  if (existing) {
    const err = new Error('Account already exists');
    err.code = 'USER_EXISTS';
    throw err;
  }

  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const preservedId = await findExistingProfileId(phoneE164, email);

  return insertAppUser({
    phoneE164,
    email,
    password_hash,
    id: preservedId ?? undefined,
  });
}

async function validateRefreshToken(refreshToken) {
  const token_hash = hashRefreshToken(refreshToken);
  console.log('[validateRefreshToken] START - token_hash:', token_hash.slice(0, 16) + '...');

  const rows = await query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NULL
     LIMIT 1`,
    [token_hash],
  );
  const row = rows[0];

  if (!row) {
    console.log('[validateRefreshToken] FAIL - token not found in DB or already revoked');
    return null;
  }

  const expiresAtMs = new Date(row.expires_at + ' UTC').getTime();
  const now = Date.now();
  console.log('[validateRefreshToken] token found - expires_at:', new Date(expiresAtMs).toISOString(), 'now:', new Date(now).toISOString());

  if (expiresAtMs < now) {
    console.log('[validateRefreshToken] FAIL - token expired by', Math.floor((now - expiresAtMs) / 1000), 'seconds');
    return null;
  }

  const users = await query('SELECT * FROM app_users WHERE id = ? LIMIT 1', [row.user_id]);
  const user = users[0];
  if (!user) {
    console.log('[validateRefreshToken] FAIL - user not found for user_id:', row.user_id);
    return null;
  }

  console.log('[validateRefreshToken] SUCCESS - user:', user.email);
  return { row, user };
}

async function revokeRefreshToken(refreshToken) {
  const token_hash = hashRefreshToken(refreshToken);

  await execute(
    `UPDATE refresh_tokens
     SET revoked_at = CURRENT_TIMESTAMP(3)
     WHERE token_hash = ? AND revoked_at IS NULL`,
    [token_hash],
  );
}

async function isProfileDeleted(userId) {
  const rows = await query('SELECT deleted_at FROM profiles WHERE id = ? LIMIT 1', [userId]);
  return !!rows[0]?.deleted_at;
}

async function refreshSessionFromToken(refreshToken) {
  const validated = await validateRefreshToken(refreshToken);
  if (!validated) {
    const err = new Error('Session refresh failed');
    err.status = 401;
    throw err;
  }

  if (await isProfileDeleted(validated.user.id)) {
    const err = new Error('This account has been deactivated.');
    err.status = 403;
    throw err;
  }

  await revokeRefreshToken(refreshToken);
  return issueSession(validated.user);
}

async function deleteAppUser(userId) {
  await execute('DELETE FROM app_users WHERE id = ?', [userId]);
}

async function findAppUserById(userId) {
  const rows = await query(
    `SELECT id, phone_e164, email, created_at, updated_at
     FROM app_users WHERE id = ? LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function findByEmail(email) {
  const rows = await query(
    'SELECT * FROM app_users WHERE email = ? LIMIT 1',
    [email],
  );
  return rows[0] ?? null;
}

function socialPlaceholderPhone(firebaseUid) {
  const digits = firebaseUid.replace(/\D/g, '').slice(0, 15);
  return `+99${digits.padEnd(15, '0').slice(0, 15)}`;
}

/**
 * Deliberately does NOT persist `fullName` (or a real `role`) to `profiles` on creation —
 * only `email`. The mobile onboarding flow (role.tsx -> your-name.tsx) is the single place
 * `full_name`/`role` get confirmed, for Google, Apple, and phone-OTP sign-in alike. If this
 * pre-filled `full_name` from the provider, the app's `needsNameSetup`/`needsRoleSetup` checks
 * would treat onboarding as already complete and skip role selection entirely, permanently
 * defaulting every social sign-up to the `role` column's DB default ('elder') with no way to
 * choose guardian. `role='elder'` below is just a NOT-NULL placeholder — your-name.tsx's
 * first `PATCH /auth/profile` always overwrites it with the user's actual choice.
 */
async function upsertSocialProfile({ id, email }) {
  await execute(
    `INSERT INTO profiles (
       id, email, role, plan_type, plan_status, plan_currency, streak
     ) VALUES (?, ?, 'elder', 'free', 'active', 'INR', 0)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email)`,
    [id, email],
  );
}

/** Shared by Google and Apple — both authenticate via a verified Firebase ID token and resolve
 *  identity purely by email, with no provider-specific column. */
async function findOrCreateBySocialProvider({ email, firebaseUid }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await findByEmail(normalizedEmail);
  if (existing) {
    return { user: existing, isNewUser: false };
  }

  const phoneE164 = socialPlaceholderPhone(firebaseUid);
  const preservedId = await findExistingProfileId(phoneE164, normalizedEmail);

  try {
    const user = await insertAppUser({
      phoneE164,
      email: normalizedEmail,
      id: preservedId ?? undefined,
    });

    await upsertSocialProfile({
      id: user.id,
      email: normalizedEmail,
    });

    return { user, isNewUser: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const retry = await findByEmail(normalizedEmail);
      if (retry) return { user: retry, isNewUser: false };
    }
    throw err;
  }
}

async function findOrCreateByGoogle({ email, firebaseUid }) {
  return findOrCreateBySocialProvider({ email, firebaseUid });
}

async function findOrCreateByApple({ email, firebaseUid }) {
  return findOrCreateBySocialProvider({ email, firebaseUid });
}

module.exports = {
  findByPhone,
  findOrCreateByPhone,
  findExistingProfileId,
  verifyPassword,
  createUserWithPassword,
  issueSession,
  revokeRefreshToken,
  refreshSessionFromToken,
  deleteAppUser,
  findAppUserById,
  findByEmail,
  findOrCreateByGoogle,
  findOrCreateByApple,
  isProfileDeleted,
};
