const { supabaseClient } = require('../config/supabase');
const { sendOtpSms, isDevMode } = require('../services/twilio.service');
const { toE164, phoneToAuthEmail, formatMobile } = require('../utils/phone');
const {
  generateCode,
  hashCode,
  verifyCode,
  OTP_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
} = require('../utils/otp');
const { signVerificationToken, verifyVerificationToken } = require('../utils/verificationToken');
const {
  findOrCreateByPhone,
  findByPhone,
  createUserWithPassword,
  verifyPassword,
  issueSession,
  revokeRefreshToken,
  refreshSessionFromToken,
} = require('../services/auth-users.service');

const RESEND_COOLDOWN_MS = 60 * 1000;

/** POST /api/auth/otp/send */
async function sendOtp(req, res) {
  try {
    const { phone, countryCode = '+91' } = req.body ?? {};
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    let phoneE164;
    try {
      phoneE164 = toE164(phone, countryCode);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    const { data: recent } = await supabaseClient
      .from('otp_verifications')
      .select('created_at')
      .eq('phone_e164', phoneE164)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent?.created_at) {
      const elapsed = Date.now() - new Date(recent.created_at).getTime();
      if (elapsed < RESEND_COOLDOWN_MS) {
        const wait = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${wait}s before requesting another OTP`,
        });
      }
    }

    const code = generateCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

    const { error: insertError } = await supabaseClient.from('otp_verifications').insert({
      phone_e164: phoneE164,
      code_hash: hashCode(code),
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error('[auth/otp/send] insert error:', insertError.message);
      return res.status(500).json({ success: false, message: 'Could not create OTP. Try again.' });
    }

    await sendOtpSms(phoneE164, code);

    return res.json({
      success: true,
      message: 'OTP sent',
      devMode: isDevMode(),
    });
  } catch (err) {
    console.error('[auth/otp/send]', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to send OTP' });
  }
}

/** POST /api/auth/otp/verify */
async function verifyOtp(req, res) {
  try {
    const { phone, countryCode = '+91', code } = req.body ?? {};
    if (!phone || !code) {
      return res.status(400).json({ success: false, message: 'Phone and OTP code are required' });
    }

    let phoneE164;
    try {
      phoneE164 = toE164(phone, countryCode);
    } catch {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    const { data: row, error } = await supabaseClient
      .from('otp_verifications')
      .select('*')
      .eq('phone_e164', phoneE164)
      .is('verified_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !row) {
      return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
    }

    if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Request a new OTP.' });
    }

    if (!verifyCode(String(code), row.code_hash)) {
      await supabaseClient
        .from('otp_verifications')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id);

      return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });
    }

    await supabaseClient
      .from('otp_verifications')
      .update({ verified_at: new Date().toISOString() })
      .eq('id', row.id);

    const verificationToken = signVerificationToken({ phone, countryCode });

    return res.json({
      success: true,
      verificationToken,
    });
  } catch (err) {
    console.error('[auth/otp/verify]', err);
    return res.status(500).json({ success: false, message: err.message || 'OTP verification failed' });
  }
}

/** POST /api/auth/otp/complete — sign in or register after OTP (no user password). */
async function completeOtpAuth(req, res) {
  try {
    const { verificationToken } = req.body ?? {};
    if (!verificationToken) {
      return res.status(400).json({ success: false, message: 'Verification token is required' });
    }

    const { phone, countryCode } = verifyVerificationToken(verificationToken);
    const phoneE164 = toE164(phone, countryCode);
    const email = phoneToAuthEmail(phone, countryCode);

    const { user, isNewUser } = await findOrCreateByPhone(phoneE164, email);
    const session = await issueSession(user);

    return res.json({
      success: true,
      isNewUser,
      session,
    });
  } catch (err) {
    console.error('[auth/otp/complete]', err);
    const status = err.message?.includes('expired') ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message || 'Could not complete sign-in' });
  }
}

/** POST /api/auth/login */
async function login(req, res) {
  try {
    const { verificationToken, password } = req.body ?? {};
    if (!verificationToken || !password) {
      return res.status(400).json({ success: false, message: 'Verification token and password are required' });
    }

    const { phone, countryCode } = verifyVerificationToken(verificationToken);
    const phoneE164 = toE164(phone, countryCode);

    const user = await findByPhone(phoneE164);
    if (!user || !(await verifyPassword(user, password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password or account not found',
        code: 'AUTH_FAILED',
      });
    }

    const session = await issueSession(user);

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    console.error('[auth/login]', err);
    const status = err.message?.includes('expired') ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message || 'Login failed' });
  }
}

/** POST /api/auth/register */
async function register(req, res) {
  try {
    const { verificationToken, password, fullName } = req.body ?? {};
    if (!verificationToken || !password || !fullName?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Verification token, password, and full name are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const { phone, countryCode } = verifyVerificationToken(verificationToken);
    const phoneE164 = toE164(phone, countryCode);
    const email = phoneToAuthEmail(phone, countryCode);
    const mobile = formatMobile(phone, countryCode);
    const trimmedName = fullName.trim();

    let user;
    try {
      user = await createUserWithPassword({ phoneE164, email, password });
    } catch (err) {
      if (err.code === 'USER_EXISTS') {
        return res.status(409).json({
          success: false,
          message: 'Account already exists. Please log in instead.',
          code: 'USER_EXISTS',
        });
      }
      console.error('[auth/register] createUser:', err.message);
      return res.status(500).json({ success: false, message: err.message ?? 'Could not create account' });
    }

    // full_name hint for onboarding — profile row may be completed in the app later
    await supabaseClient.from('profiles').upsert(
      {
        id: user.id,
        full_name: trimmedName,
        email,
        mobile,
      },
      { onConflict: 'id', ignoreDuplicates: false },
    );

    const session = await issueSession(user);

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    console.error('[auth/register]', err);
    const status = err.message?.includes('expired') ? 400 : 500;
    return res.status(status).json({ success: false, message: err.message || 'Registration failed' });
  }
}

/** POST /api/auth/refresh */
async function refreshSession(req, res) {
  try {
    const { refresh_token: refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'refresh_token is required' });
    }

    const session = await refreshSessionFromToken(refreshToken);

    return res.json({
      success: true,
      session,
    });
  } catch (err) {
    console.error('[auth/refresh]', err);
    const status = err.status === 401 ? 401 : 500;
    return res.status(status).json({ success: false, message: 'Session refresh failed' });
  }
}

/** POST /api/auth/logout */
async function logout(req, res) {
  try {
    const { refresh_token: refreshToken } = req.body ?? {};
    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'refresh_token is required' });
    }

    await revokeRefreshToken(refreshToken);

    return res.json({ success: true, message: 'Logged out' });
  } catch (err) {
    console.error('[auth/logout]', err);
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
}

/** GET /api/auth/me */
async function getMe(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    const email = req.auth?.email ?? req.supabase?.email;

    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('[auth/me] profile error:', error.message);
      return res.status(500).json({ success: false, message: 'Could not load profile' });
    }

    return res.json({
      success: true,
      user: {
        id: userId,
        email,
      },
      profile: profile ?? null,
    });
  } catch (err) {
    console.error('[auth/me]', err);
    return res.status(500).json({ success: false, message: 'Could not load user' });
  }
}

module.exports = {
  sendOtp,
  verifyOtp,
  completeOtpAuth,
  login,
  register,
  refreshSession,
  logout,
  getMe,
};
