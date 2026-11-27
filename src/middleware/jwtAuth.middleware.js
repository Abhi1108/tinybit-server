const { verifyAccessToken } = require('../services/jwt.service');
const { isProfileDeleted } = require('../services/auth-users.service');
const { touchLastActive } = require('../services/profiles.service');

function touchLastActiveSafe(userId) {
  if (!userId) return;
  void touchLastActive(userId).catch((err) => {
    console.warn('[auth] last_active update failed:', err.message);
  });
}

async function requireJwtAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth] JWT_SECRET is not set in .env');
    return res.status(500).json({ success: false, message: 'Server auth not configured' });
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (_error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }

  try {
    if (await isProfileDeleted(payload.sub)) {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_DEACTIVATED',
        message: 'Account has been deleted',
      });
    }

    const auth = {
      userId: payload.sub,
      email: payload.email,
    };
    req.auth = auth;
    touchLastActiveSafe(auth.userId);
    return next();
  } catch (err) {
    console.error('[auth] account check error:', err.message);
    return res.status(500).json({ success: false, message: 'Could not verify account status' });
  }
}

module.exports = { requireJwtAuth };
