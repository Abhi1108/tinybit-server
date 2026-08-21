const jwt = require('jsonwebtoken');

const ADMIN_JWT_AUD = 'tinybit-admin';
const ADMIN_SESSION_TTL = '24h';

function getAdminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'tinybit-admin-dev-secret';
}

function signAdminToken({ id, username, role, roleId, name, permissions }) {
  return jwt.sign(
    {
      sub: id,
      username,
      role,
      role_id: roleId || null,
      name: name || username,
      permissions: Array.isArray(permissions) ? permissions : [],
    },
    getAdminJwtSecret(),
    { expiresIn: ADMIN_SESSION_TTL, audience: ADMIN_JWT_AUD },
  );
}

function checkSession(token) {
  try {
    return jwt.verify(token, getAdminJwtSecret(), { audience: ADMIN_JWT_AUD });
  } catch {
    return null;
  }
}

module.exports = {
  ADMIN_JWT_AUD,
  signAdminToken,
  checkSession,
};
