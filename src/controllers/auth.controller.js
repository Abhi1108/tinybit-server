const { supabaseClient } = require('../config/supabase');
const { toE164, phoneToAuthEmail, formatMobile } = require('../utils/phone');
const { verifyVerificationToken } = require('../utils/verificationToken');
const {
  findOrCreateByPhone,
  findByPhone,
  createUserWithPassword,
  verifyPassword,
  issueSession,
  revokeRefreshToken,
  refreshSessionFromToken,
  findOrCreateByGoogle,
} = require('../services/auth-users.service');
const {
  verifyFirebaseIdToken,
  getFirebaseAdminStatus,
  peekJwtClaims,
  normalizeIdToken,
} = require('../services/firebase-admin.service');

const OTP_REMOVED_MESSAGE =
  'Twilio OTP was removed. Update the app and sign in with Firebase phone auth.';

/** POST /api/auth/otp/* — removed (Firebase phone auth on device). */
function deprecatedOtpEndpoint(_req, res) {
  return res.status(410).json({
    success: false,
    message: OTP_REMOVED_MESSAGE,
    hint: 'Install a recent TinyBit build. OTP is sent by Firebase on the device, then exchanged at POST /api/auth/phone.',
  });
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

/** GET /api/auth/google/status — Firebase Admin config check (no secrets). */
function googleAuthStatus(req, res) {
  const status = getFirebaseAdminStatus();
  return res.json({
    success: true,
    ...status,
    phoneAuth: 'firebase-on-device',
    hint: status.projectMatchesApp === false
      ? `Vercel service account is for "${status.projectId}" but the app uses "${status.expectedProjectId}". ` +
        'Download the service account key from the same Firebase project as google-services.json.'
      : !status.configured
        ? 'Set FIREBASE_SERVICE_ACCOUNT_JSON on Vercel, then redeploy.'
        : 'Firebase Admin looks correctly configured. Phone OTP is sent on-device via Firebase; rebuild the app after updating google-services.json.',
  });
}

/** POST /api/auth/google — Firebase Google ID token → TinyBit session */
async function googleAuth(req, res) {
  try {
    const { idToken } = req.body ?? {};
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'idToken is required' });
    }

    let token;
    try {
      token = normalizeIdToken(idToken);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'idToken is invalid',
      });
    }

    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(token);
    } catch (err) {
      const status = getFirebaseAdminStatus();
      const claims = peekJwtClaims(token);
      console.error('[auth/google] token verify failed:', err.code || err.message, {
        adminProjectId: status.projectId,
        expectedProjectId: status.expectedProjectId,
        tokenLength: token.length,
        tokenClaims: claims,
      });

      let hint;
      if (claims?.iss && !String(claims.iss).includes('securetoken.google.com')) {
        hint = 'App sent a Google OAuth token, not a Firebase ID token. Rebuild the app and sign in again.';
      } else if (claims?.aud && claims.aud !== status.expectedProjectId) {
        hint = `Token audience is "${claims.aud}" but server expects "${status.expectedProjectId}".`;
      } else if (status.projectMatchesApp === false) {
        hint = `Server Firebase project (${status.projectId}) does not match app (${status.expectedProjectId}).`;
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid Google sign-in token',
        hint,
      });
    }

    const email = decoded.email;
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Google account must include an email address',
      });
    }

    const fullName = decoded.name ?? decoded.display_name ?? null;
    const { user, isNewUser } = await findOrCreateByGoogle({
      email,
      fullName,
      firebaseUid: decoded.uid,
    });

    if (fullName && isNewUser) {
      await supabaseClient.from('profiles').upsert(
        { id: user.id, full_name: fullName, email: user.email },
        { onConflict: 'id' },
      );
    }

    const session = await issueSession(user);

    return res.json({
      success: true,
      isNewUser,
      session,
    });
  } catch (err) {
    console.error('[auth/google]', err);
    return res.status(500).json({ success: false, message: err.message || 'Google sign-in failed' });
  }
}

/** POST /api/auth/phone — Firebase phone ID token → TinyBit session */
async function phoneAuth(req, res) {
  try {
    const { idToken } = req.body ?? {};
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'idToken is required' });
    }

    let token;
    try {
      token = normalizeIdToken(idToken);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'idToken is invalid',
      });
    }

    let decoded;
    try {
      decoded = await verifyFirebaseIdToken(token);
    } catch (err) {
      const status = getFirebaseAdminStatus();
      const claims = peekJwtClaims(token);
      console.error('[auth/phone] token verify failed:', err.code || err.message, {
        adminProjectId: status.projectId,
        expectedProjectId: status.expectedProjectId,
        tokenLength: token.length,
        tokenClaims: claims,
      });

      let hint;
      if (claims?.iss && !String(claims.iss).includes('securetoken.google.com')) {
        hint = 'App sent a non-Firebase token. Rebuild the app and sign in again.';
      } else if (claims?.aud && claims.aud !== status.expectedProjectId) {
        hint = `Token audience is "${claims.aud}" but server expects "${status.expectedProjectId}".`;
      } else if (status.projectMatchesApp === false) {
        hint = `Server Firebase project (${status.projectId}) does not match app (${status.expectedProjectId}).`;
      } else if (!status.configured) {
        hint = 'Set FIREBASE_SERVICE_ACCOUNT_JSON on Vercel, then redeploy tinybit-server.';
      }

      return res.status(401).json({
        success: false,
        message: 'Invalid phone sign-in token',
        hint,
      });
    }

    const phoneNumber = decoded.phone_number;
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Firebase token must include a verified phone_number claim',
      });
    }

    const phoneE164 = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber.replace(/\D/g, '')}`;
    const digitsOnly = phoneE164.replace(/\D/g, '');
    const email = `${digitsOnly}@phone.tinybit.app`;

    const { user, isNewUser } = await findOrCreateByPhone(phoneE164, email);

    if (isNewUser) {
      await supabaseClient.from('profiles').upsert(
        { id: user.id, email: user.email, mobile: phoneE164 },
        { onConflict: 'id' },
      );
    }

    const session = await issueSession(user);

    return res.json({
      success: true,
      isNewUser,
      session,
    });
  } catch (err) {
    console.error('[auth/phone]', err);
    return res.status(500).json({ success: false, message: err.message || 'Phone sign-in failed' });
  }
}

/** PATCH /api/auth/profile — upsert onboarding / profile fields (service role, no Supabase JWT on client). */
async function updateProfile(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    const email = req.auth?.email ?? req.supabase?.email;
    const body = req.body ?? {};

    const allowed = [
      'role',
      'first_name',
      'last_name',
      'full_name',
      'mobile',
      'location',
      'preferred_language',
      'biological_sex',
      'height',
      'height_unit',
      'weight',
      'weight_unit',
      'date_of_birth',
      'blood_group',
      'medical_conditions',
      'emergency_name',
      'emergency_phone',
      'emergency_relation',
    ];

    const patch = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'No profile fields to update' });
    }

    const row = {
      id: userId,
      email: email ?? null,
      plan_type: 'free',
      plan_status: 'active',
      plan_currency: 'INR',
      streak: 0,
      ...patch,
    };

    const { data, error } = await supabaseClient
      .from('profiles')
      .upsert(row, { onConflict: 'id' })
      .select('*')
      .single();

    if (error) {
      console.error('[auth/profile] upsert error:', error.message);
      if (error.code === '23503' && /profiles_id_fkey/i.test(error.message ?? '')) {
        return res.status(500).json({
          success: false,
          message:
            'Database setup incomplete: profiles must reference app_users. Run migration 010_app_users_jwt.sql in Supabase.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not save profile' });
    }

    return res.json({ success: true, profile: data });
  } catch (err) {
    console.error('[auth/profile]', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save profile' });
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

const USER_SETTINGS_COLUMNS =
  'user_id, voice_navigation, vibration_alerts, fall_detection, night_mode, font_scale, language, updated_at';

/** GET /api/auth/settings */
async function getSettings(req, res) {
  try {
    const userId = req.auth.userId;
    const { data, error } = await supabaseClient
      .from('user_settings')
      .select(USER_SETTINGS_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return res.json({ success: true, settings: null });
      }
      console.error('[auth/settings] read error:', error.message);
      return res.status(500).json({ success: false, message: 'Could not load settings' });
    }

    return res.json({ success: true, settings: data ?? null });
  } catch (err) {
    console.error('[auth/settings]', err);
    return res.status(500).json({ success: false, message: 'Could not load settings' });
  }
}

/** PATCH /api/auth/settings */
async function updateSettings(req, res) {
  try {
    const userId = req.auth.userId;
    const body = req.body ?? {};
    const allowed = [
      'voice_navigation',
      'vibration_alerts',
      'fall_detection',
      'night_mode',
      'font_scale',
      'language',
    ];

    const patch = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'No settings to update' });
    }

    const { data, error } = await supabaseClient
      .from('user_settings')
      .upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' })
      .select(USER_SETTINGS_COLUMNS)
      .single();

    if (error) {
      console.error('[auth/settings] upsert error:', error.message);
      return res.status(500).json({ success: false, message: 'Could not save settings' });
    }

    return res.json({ success: true, settings: data });
  } catch (err) {
    console.error('[auth/settings]', err);
    return res.status(500).json({ success: false, message: 'Could not save settings' });
  }
}

module.exports = {
  deprecatedOtpEndpoint,
  login,
  register,
  googleAuth,
  phoneAuth,
  googleAuthStatus,
  refreshSession,
  logout,
  getMe,
  updateProfile,
  getSettings,
  updateSettings,
};
