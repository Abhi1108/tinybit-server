const { verifyAccessToken } = require('../services/jwt.service');

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
    // Backward compat for controllers that read req.supabase
    req.supabase = auth;
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
}

module.exports = { requireJwtAuth };
