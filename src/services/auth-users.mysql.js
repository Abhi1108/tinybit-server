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

  const preservedId = await findExistingProfileId(phoneE164, email);

  try {
    const user = await insertAppUser({
      phoneE164,
      email,
      id: preservedId ?? undefined,
    });
    return { user, isNewUser: true };
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      const retry = await findByPhone(phoneE164);
      if (retry) return { user: retry, isNewUser: false };
    }
    throw err;
  }
}

async function storeRefreshToken(userId, refreshToken) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await execute(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES (?, ?, ?)`,
    [userId, hashRefreshToken(refreshToken), expiresAt],
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

  const rows = await query(
    `SELECT * FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NULL
     LIMIT 1`,
    [token_hash],
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  const users = await query('SELECT * FROM app_users WHERE id = ? LIMIT 1', [row.user_id]);
  const user = users[0];
  if (!user) return null;

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

async function refreshSessionFromToken(refreshToken) {
  const validated = await validateRefreshToken(refreshToken);
  if (!validated) {
    const err = new Error('Session refresh failed');
    err.status = 401;
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

function googlePlaceholderPhone(firebaseUid) {
  const digits = firebaseUid.replace(/\D/g, '').slice(0, 15);
  return `+99${digits.padEnd(15, '0').slice(0, 15)}`;
}

async function upsertGoogleProfile({ id, email, fullName }) {
  await execute(
    `INSERT INTO profiles (
       id, email, full_name, role, plan_type, plan_status, plan_currency, streak
     ) VALUES (?, ?, ?, 'elder', 'free', 'active', 'INR', 0)
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       full_name = COALESCE(VALUES(full_name), full_name)`,
    [id, email, fullName?.trim() || null],
  );
}

async function findOrCreateByGoogle({ email, fullName, firebaseUid }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await findByEmail(normalizedEmail);
  if (existing) {
    return { user: existing, isNewUser: false };
  }

  const phoneE164 = googlePlaceholderPhone(firebaseUid);
  const preservedId = await findExistingProfileId(phoneE164, normalizedEmail);

  try {
    const user = await insertAppUser({
      phoneE164,
      email: normalizedEmail,
      id: preservedId ?? undefined,
    });

    await upsertGoogleProfile({
      id: user.id,
      email: normalizedEmail,
      fullName,
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
};
