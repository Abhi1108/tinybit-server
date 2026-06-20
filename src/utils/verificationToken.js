const crypto = require('crypto');

const TOKEN_TTL_MS = 15 * 60 * 1000;

function getSecret() {
  return process.env.OTP_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-otp-secret';
}

function signVerificationToken({ phone, countryCode }) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = JSON.stringify({ phone, countryCode, exp });
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  const bundle = JSON.stringify({ payload, sig });
  return Buffer.from(bundle).toString('base64url');
}

function verifyVerificationToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('Verification token is required');
  }

  let parsed;
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid verification token');
  }

  const { payload, sig } = parsed;
  if (!payload || !sig) throw new Error('Invalid verification token');

  const expected = crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
  if (sig !== expected) throw new Error('Invalid verification token');

  const data = JSON.parse(payload);
  if (!data.phone || !data.countryCode) throw new Error('Invalid verification token');
  if (Date.now() > data.exp) throw new Error('Verification expired. Please request a new OTP.');

  return { phone: data.phone, countryCode: data.countryCode };
}

module.exports = { signVerificationToken, verifyVerificationToken, TOKEN_TTL_MS };
