const bcrypt = require('bcrypt');
const { supabaseClient } = require('../config/supabase');
const { signAccessToken, generateRefreshToken, hashRefreshToken, accessExpiresAtUnix, ACCESS_TTL_SECONDS } = require('./jwt.service');

const REFRESH_TTL_DAYS = parseInt(process.env.JWT_REFRESH_TTL_DAYS || '30', 10);
const BCRYPT_ROUNDS = 12;

async function findByPhone(phoneE164) {
  const { data, error } = await supabaseClient
    .from('app_users')
    .select('*')
    .eq('phone_e164', phoneE164)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findExistingProfileId(phoneE164, email) {
  const { data: byMobile, error: mobileErr } = await supabaseClient
    .from('profiles')
    .select('id')
    .eq('mobile', phoneE164)
    .maybeSingle();

  if (mobileErr) throw mobileErr;
  if (byMobile?.id) return byMobile.id;

  const { data: byEmail, error: emailErr } = await supabaseClient
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (emailErr) throw emailErr;
  return byEmail?.id ?? null;
}

async function findOrCreateByPhone(phoneE164, email) {
  const existing = await findByPhone(phoneE164);
  if (existing) {
    return { user: existing, isNewUser: false };
  }

  const preservedId = await findExistingProfileId(phoneE164, email);
  const insertPayload = {
    phone_e164: phoneE164,
    email,
    ...(preservedId ? { id: preservedId } : {}),
  };

  const { data, error } = await supabaseClient
    .from('app_users')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      const retry = await findByPhone(phoneE164);
      if (retry) return { user: retry, isNewUser: false };
    }
    throw error;
  }

  return { user: data, isNewUser: true };
}

async function storeRefreshToken(userId, refreshToken) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseClient.from('refresh_tokens').insert({
    user_id:    userId,
    token_hash: hashRefreshToken(refreshToken),
    expires_at: expiresAt,
  });

  if (error) throw error;
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

  const { data, error } = await supabaseClient
    .from('app_users')
    .insert({
      phone_e164: phoneE164,
      email,
      password_hash,
      ...(preservedId ? { id: preservedId } : {}),
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

async function validateRefreshToken(refreshToken) {
  const token_hash = hashRefreshToken(refreshToken);

  const { data, error } = await supabaseClient
    .from('refresh_tokens')
    .select('*')
    .eq('token_hash', token_hash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;

  const { data: user, error: userErr } = await supabaseClient
    .from('app_users')
    .select('*')
    .eq('id', data.user_id)
    .single();

  if (userErr) throw userErr;
  return { row: data, user };
}

async function revokeRefreshToken(refreshToken) {
  const token_hash = hashRefreshToken(refreshToken);

  const { error } = await supabaseClient
    .from('refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', token_hash)
    .is('revoked_at', null);

  if (error) throw error;
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
  const { error } = await supabaseClient.from('app_users').delete().eq('id', userId);
  if (error) throw error;
}

async function findAppUserById(userId) {
  const { data, error } = await supabaseClient
    .from('app_users')
    .select('id, phone_e164, email, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findByEmail(email) {
  const { data, error } = await supabaseClient
    .from('app_users')
    .select('*')
    .eq('email', email)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function googlePlaceholderPhone(firebaseUid) {
  const digits = firebaseUid.replace(/\D/g, '').slice(0, 15);
  return `+99${digits.padEnd(15, '0').slice(0, 15)}`;
}

async function findOrCreateByGoogle({ email, fullName, firebaseUid }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await findByEmail(normalizedEmail);
  if (existing) {
    return { user: existing, isNewUser: false };
  }

  const phoneE164 = googlePlaceholderPhone(firebaseUid);
  const preservedId = await findExistingProfileId(phoneE164, normalizedEmail);

  const { data, error } = await supabaseClient
    .from('app_users')
    .insert({
      phone_e164: phoneE164,
      email: normalizedEmail,
      ...(preservedId ? { id: preservedId } : {}),
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      const retry = await findByEmail(normalizedEmail);
      if (retry) return { user: retry, isNewUser: false };
    }
    throw error;
  }

  await supabaseClient.from('profiles').upsert(
    {
      id: data.id,
      email: normalizedEmail,
      full_name: fullName?.trim() || null,
      role: 'elder',
      plan_type: 'free',
      plan_status: 'active',
      plan_currency: 'INR',
      streak: 0,
    },
    { onConflict: 'id', ignoreDuplicates: false },
  );

  return { user: data, isNewUser: true };
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
