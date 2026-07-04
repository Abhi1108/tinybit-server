/**
 * JWT access tokens — signed with JWT_SECRET.
 *
 * JWT access tokens — signed with JWT_SECRET (no Supabase dependency).
 *   JWT_ACCESS_TTL_SECONDS     — default 3600 (1 hour)
 *   JWT_REFRESH_TTL_DAYS       — default 30
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = process.env.JWT_ISSUER || 'https://tinybit.app/auth';
const ACCESS_TTL_SECONDS = Number(process.env.JWT_ACCESS_TTL_SECONDS || 3600);
const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS || 30);

function assertJwtSecret() {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }
}

/** @param {{ id: string, email: string }} user */
function signAccessToken(user) {
  assertJwtSecret();
  const payload = {
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
  };

  if (JWT_ISSUER) {
    payload.iss = JWT_ISSUER;
  }

  return jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TTL_SECONDS,
  });
}

function verifyAccessToken(token) {
  assertJwtSecret();
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ['HS256'],
    audience: 'authenticated',
  });
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function accessExpiresAtUnix() {
  return Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS;
}

function refreshExpiresAt() {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  accessExpiresAtUnix,
  refreshExpiresAt,
  ACCESS_TTL_SECONDS,
};
