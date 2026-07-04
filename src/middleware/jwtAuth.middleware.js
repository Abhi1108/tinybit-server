const { verifyAccessToken } = require('../services/jwt.service');
const { touchLastActive } = require('../services/profiles.service');

function touchLastActiveSafe(userId) {
  if (!userId) return;
  void touchLastActive(userId).catch((err) => {
    console.warn('[auth] last_active update failed:', err.message);
  });
}

function requireJwtAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth] JWT_SECRET is not set in .env');
    return res.status(500).json({ success: false, message: 'Server auth not configured' });
  }

  try {
    const payload = verifyAccessToken(token);
    const auth = {
      userId: payload.sub,
      email: payload.email,
    };
    req.auth = auth;
    req.supabase = auth;
    touchLastActiveSafe(auth.userId);
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
}

module.exports = { requireJwtAuth };
