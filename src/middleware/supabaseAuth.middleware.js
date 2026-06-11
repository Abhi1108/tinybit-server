const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const requireSupabaseAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'No token, authorization denied' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[auth] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in .env');
    return res.status(500).json({ success: false, message: 'Server auth not configured' });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_SERVICE_KEY,
      },
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      return res.status(401).json({ success: false, message: 'Token invalid or expired' });
    }

    const user = await response.json();
    req.supabase = {
      userId: user.id,
      email: user.email,
      raw: user,
    };
    return next();
  } catch (_error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

module.exports = { requireSupabaseAuth };
