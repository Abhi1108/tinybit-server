const path = require('path');
const jwt = require('jsonwebtoken');
const { toE164, phoneToAuthEmail } = require('../utils/phone');
const {
  createUserWithPassword,
  deleteAppUser,
  findAppUserById,
  findByPhone,
  findOrCreateByPhone,
} = require('../services/auth-users.service');
const adminService = require('../services/admin.service');

const ADMIN_JWT_AUD = 'tinybit-admin';
const ADMIN_SESSION_TTL = '24h';

function getAdminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'tinybit-admin-dev-secret';
}

function signAdminToken(username) {
  return jwt.sign(
    { sub: 'admin', username, role: 'admin' },
    getAdminJwtSecret(),
    { expiresIn: ADMIN_SESSION_TTL, audience: ADMIN_JWT_AUD },
  );
}

const PROFILE_PATCH_FIELDS = [
  'full_name', 'first_name', 'last_name', 'email', 'mobile', 'role',
  'country', 'country_code', 'age', 'biological_sex', 'location',
  'preferred_language', 'blood_group', 'medical_conditions',
  'emergency_phone', 'emergency_name', 'emergency_relation',
  'plan_type', 'plan_status', 'is_banned',
];

// ── Auth ────────────────────────────────────────────────────────────────────

const checkSession = (token) => {
  try {
    jwt.verify(token, getAdminJwtSecret(), { audience: ADMIN_JWT_AUD });
    return true;
  } catch {
    return false;
  }
};

const login = (req, res) => {
  const { username, password } = req.body ?? {};
  const validUser = process.env.ADMIN_USERNAME ?? 'admin';
  const validPass = process.env.ADMIN_PASSWORD ?? 'tinybit2025';
  if (username === validUser && password === validPass) {
    const token = signAdminToken(username);
    return res.json({ success: true, token, user: { username, role: 'admin' } });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
};

const logout = (_req, res) => {
  return res.json({ success: true });
};

// ── Dashboard ───────────────────────────────────────────────────────────────

const getStats = async (req, res) => {
  try {
    const stats = await adminService.getDashboardStats();
    return res.json(stats);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const analytics = await adminService.getAnalytics();
    return res.json(analytics);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ── Users ───────────────────────────────────────────────────────────────────

const getUsers = async (req, res) => {
  const { role, search, status, page = '1', limit = '20' } = req.query;

  try {
    const result = await adminService.getUsers({ role, search, status, page, limit });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const getIncompleteUsers = async (req, res) => {
  const { page = '1', limit = '20' } = req.query;

  try {
    const result = await adminService.getIncompleteUsers({ page, limit });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const exportUsers = async (req, res) => {
  const { role, status } = req.query;

  try {
    const rows = await adminService.exportUsers({ role, status });
    const header = ['id', 'full_name', 'email', 'mobile', 'role', 'country', 'age', 'is_banned', 'created_at', 'last_active'];
    const escape = (v) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      header.join(','),
      ...rows.map((r) => header.map((k) => escape(r[k])).join(',')),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tinybit-users-${role || 'all'}.csv"`);
    return res.send(lines.join('\n'));
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const [profile, appUser, linksAsGuardian, linksAsElder] = await Promise.all([
      adminService.getProfileById(id),
      findAppUserById(id),
      adminService.getGuardianLinksByGuardianId(id),
      adminService.getGuardianLinksByElderId(id),
    ]);

    if (!profile && !appUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const linkIds = [
      ...linksAsGuardian.map((l) => l.elder_id).filter(Boolean),
      ...linksAsElder.map((l) => l.guardian_id),
    ];
    const userMap = await adminService.fetchUserMap([...new Set(linkIds)]);

    const enrichLink = (link) => ({
      ...link,
      guardian_name: userMap[link.guardian_id]?.full_name ?? '—',
      guardian_email: userMap[link.guardian_id]?.email ?? '—',
      elder_name: link.elder_id ? (userMap[link.elder_id]?.full_name ?? '—') : '—',
    });

    return res.json({
      success: true,
      profile,
      app_user: appUser,
      connections: {
        as_guardian: linksAsGuardian.map(enrichLink),
        as_elder: linksAsElder.map(enrichLink),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const createUser = async (req, res) => {
  const {
    phone,
    countryCode = '+91',
    fullName,
    password,
    role = 'elder',
    email: explicitEmail,
    ...rest
  } = req.body ?? {};

  if (!phone) {
    return res.status(400).json({ success: false, error: 'phone is required' });
  }
  if (!['elder', 'guardian', 'caregiver'].includes(role)) {
    return res.status(400).json({ success: false, error: 'Invalid role' });
  }

  try {
    const phoneE164 = toE164(phone, countryCode);
    const authEmail = explicitEmail || phoneToAuthEmail(phone, countryCode);

    let appUser;
    if (password) {
      appUser = await createUserWithPassword({ phoneE164, email: authEmail, password });
    } else {
      const existing = await findByPhone(phoneE164);
      if (existing) {
        return res.status(409).json({ success: false, error: 'User with this phone already exists' });
      }
      const created = await findOrCreateByPhone(phoneE164, authEmail);
      appUser = created.user;
    }

    const profilePayload = {
      id: appUser.id,
      full_name: fullName || null,
      email: explicitEmail || authEmail,
      mobile: phoneE164,
      role,
      plan_type: 'free',
      plan_status: 'active',
      plan_currency: 'INR',
      streak: 0,
      is_banned: false,
    };

    PROFILE_PATCH_FIELDS.forEach((key) => {
      if (rest[key] !== undefined) profilePayload[key] = rest[key];
    });

    const profile = await adminService.upsertProfile(profilePayload);
    return res.status(201).json({ success: true, profile, app_user: appUser });
  } catch (err) {
    if (err.code === 'USER_EXISTS') {
      return res.status(409).json({ success: false, error: 'User already exists' });
    }
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const updateUser = async (req, res) => {
  const { id } = req.params;
  const body = req.body ?? {};
  const patch = {};

  PROFILE_PATCH_FIELDS.forEach((key) => {
    if (body[key] !== undefined) patch[key] = body[key];
  });

  if (!Object.keys(patch).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    const profile = await adminService.updateProfile(id, patch);
    return res.json({ success: true, profile });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const banUser = async (req, res) => {
  const { id } = req.params;
  const { banned } = req.body;
  try {
    await adminService.updateProfile(id, { is_banned: !!banned });
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({
      success: false,
      error: err.message ?? 'Update failed. Run migration 054 to add the is_banned column.',
    });
  }
};

const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const appUser = await findAppUserById(id);
    if (appUser) {
      await deleteAppUser(id);
      return res.json({ success: true });
    }

    await adminService.deleteProfile(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

// ── Connections ─────────────────────────────────────────────────────────────

const getConnections = async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;

  try {
    const result = await adminService.getConnections({ status, page, limit, search });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const updateConnection = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!['connected', 'declined', 'pending'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  try {
    const connection = await adminService.updateConnection(id, status);
    return res.json({ success: true, connection });
  } catch (err) {
    return res.status(err.status || 500).json({ success: false, error: err.message });
  }
};

const deleteConnection = async (req, res) => {
  const { id } = req.params;
  try {
    await adminService.deleteConnection(id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Medicines ────────────────────────────────────────────────────────────────

const getMedicines = async (req, res) => {
  const { page = 1, limit = 20, category, priority, active } = req.query;

  try {
    const medicines = await adminService.getMedicines({ page, limit, category, priority, active });
    return res.json({ success: true, medicines });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Daily Check-ins ──────────────────────────────────────────────────────────

const getCheckIns = async (req, res) => {
  const { page = 1, limit = 20, mood } = req.query;

  try {
    const check_ins = await adminService.getCheckIns({ page, limit, mood });
    return res.json({ success: true, check_ins });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Moods ────────────────────────────────────────────────────────────────────

const getMoods = async (req, res) => {
  const { page = 1, limit = 20, mood } = req.query;

  try {
    const moods = await adminService.getMoods({ page, limit, mood });
    return res.json({ success: true, moods });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── AI Conversations ─────────────────────────────────────────────────────────

const getAIConversations = async (req, res) => {
  const { page = 1, limit = 20, role } = req.query;

  try {
    const conversations = await adminService.getAIConversations({ page, limit, role });
    return res.json({ success: true, conversations });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Care Events ───────────────────────────────────────────────────────────────

const getCareEvents = async (req, res) => {
  const { page = 1, limit = 20, type } = req.query;

  try {
    const events = await adminService.getCareEvents({ page, limit, type });
    return res.json({ success: true, events });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Mind Games ────────────────────────────────────────────────────────────────

const getMindGames = async (req, res) => {
  const { page = 1, limit = 20, game_type } = req.query;

  try {
    const scores = await adminService.getMindGames({ page, limit, game_type });
    return res.json({ success: true, scores });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Broadcast Notification ────────────────────────────────────────────────────

const broadcast = async (req, res) => {
  const { title, body } = req.body ?? {};
  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title and body are required' });
  }

  try {
    const sent = await adminService.broadcastNotification(title, body);
    return res.json({ success: true, sent });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Serve dashboard ───────────────────────────────────────────────────────────

const serveDashboard = (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/admin/index.html'));
};

module.exports = {
  checkSession,
  login, logout,
  serveDashboard,
  getStats, getAnalytics,
  getUsers, getIncompleteUsers, exportUsers, getUserById, createUser, updateUser,
  banUser, deleteUser,
  getConnections, updateConnection, deleteConnection,
  getMedicines,
  getCheckIns,
  getMoods,
  getAIConversations,
  getCareEvents,
  getMindGames,
  broadcast,
};
