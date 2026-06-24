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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

function parseContentRangeTotal(contentRange) {
  if (!contentRange) return null;
  const match = contentRange.match(/\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

async function supabaseAdmin(endpoint, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    data: text ? JSON.parse(text) : null,
    contentRange: res.headers.get('content-range'),
  };
}

async function supabaseAuthAdmin(endpoint, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function attachConnectionCounts(users, role) {
  if (!users.length) return users;

  const ids = users.map((u) => u.id).join(',');
  if (role === 'guardian') {
    const linksRes = await supabaseAdmin(
      `/guardian_elder_links?guardian_id=in.(${ids})&status=eq.connected&select=guardian_id`,
    );
    const counts = {};
    (linksRes.data ?? []).forEach((l) => {
      counts[l.guardian_id] = (counts[l.guardian_id] || 0) + 1;
    });
    return users.map((u) => ({ ...u, linked_elder_count: counts[u.id] || 0 }));
  }

  if (role === 'elder') {
    const linksRes = await supabaseAdmin(
      `/guardian_elder_links?elder_id=in.(${ids})&status=eq.connected&select=elder_id`,
    );
    const counts = {};
    (linksRes.data ?? []).forEach((l) => {
      if (l.elder_id) counts[l.elder_id] = (counts[l.elder_id] || 0) + 1;
    });
    return users.map((u) => ({ ...u, guardian_count: counts[u.id] || 0 }));
  }

  return users;
}

const PROFILE_PATCH_FIELDS = [
  'full_name', 'first_name', 'last_name', 'email', 'mobile', 'role',
  'country', 'country_code', 'age', 'biological_sex', 'location',
  'preferred_language', 'blood_group', 'medical_conditions',
  'emergency_phone', 'emergency_name', 'emergency_relation',
  'plan_type', 'plan_status', 'is_banned',
];

// Helper: fetch profile names for a set of user IDs
async function fetchUserMap(userIds) {
  if (!userIds.length) return {};
  const res = await supabaseAdmin(
    `/profiles?id=in.(${userIds.join(',')})&select=id,full_name,email`,
  );
  const map = {};
  (res.data ?? []).forEach((u) => { map[u.id] = u; });
  return map;
}

// ── Auth ────────────────────────────────────────────────────────────────────

// Exported so the route middleware can call it without coupling to req/res
const checkSession = (token) => {
  try {
    jwt.verify(token, getAdminJwtSecret(), { audience: ADMIN_JWT_AUD });
    return true;
  } catch {
    return false;
  }
};

// POST /admin/api/login
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

// POST /admin/api/logout
const logout = (_req, res) => {
  // JWT is stateless — client discards the token.
  return res.json({ success: true });
};

// ── Dashboard ───────────────────────────────────────────────────────────────

// GET /admin/api/stats
const getStats = async (req, res) => {
  try {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const weekAgo   = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const [
      eldersRes, guardiansRes, connectedRes, pendingRes, weekRes,
      medsRes, checkInRes, moodRes, aiRes,
    ] = await Promise.all([
      supabaseAdmin('/profiles?role=eq.elder&select=id'),
      supabaseAdmin('/profiles?role=eq.guardian&select=id'),
      supabaseAdmin('/guardian_elder_links?status=eq.connected&select=id'),
      supabaseAdmin('/guardian_elder_links?status=eq.pending&select=id'),
      supabaseAdmin(`/profiles?created_at=gte.${weekAgo}&select=id`),
      supabaseAdmin('/medicines?is_active=eq.true&select=id'),
      supabaseAdmin(`/daily_checkins?created_at=gte.${yesterday}&select=id`),
      supabaseAdmin(`/mood_entries?created_at=gte.${weekAgo}&select=id`),
      supabaseAdmin(`/ai_conversations?created_at=gte.${yesterday}&select=id`),
    ]);

    return res.json({
      elders:              eldersRes.data?.length   ?? 0,
      guardians:           guardiansRes.data?.length ?? 0,
      active_connections:  connectedRes.data?.length ?? 0,
      pending_invitations: pendingRes.data?.length   ?? 0,
      new_this_week:       weekRes.data?.length      ?? 0,
      active_medicines:    medsRes.data?.length      ?? 0,
      check_ins_today:     checkInRes.data?.length   ?? 0,
      moods_this_week:     moodRes.data?.length      ?? 0,
      ai_messages_today:   aiRes.data?.length        ?? 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// GET /admin/api/analytics  — chart data for dashboard
const getAnalytics = async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();

    const [usersRes, moodsRes, checkInsRes, medsRes, aiRes, careRes, gamesRes] =
      await Promise.all([
        supabaseAdmin(`/profiles?created_at=gte.${thirtyDaysAgo}&select=created_at`),
        supabaseAdmin(`/mood_entries?created_at=gte.${thirtyDaysAgo}&select=mood_score,created_at`),
        supabaseAdmin(`/daily_checkins?created_at=gte.${thirtyDaysAgo}&select=created_at`),
        supabaseAdmin('/medicines?select=category'),
        supabaseAdmin(`/ai_conversations?created_at=gte.${thirtyDaysAgo}&select=created_at,role`),
        supabaseAdmin('/care_events?select=type'),
        supabaseAdmin('/mind_games_scores?select=game_type,score'),
      ]);

    // User growth — last 30 days
    const growth = {};
    for (let i = 29; i >= 0; i--) {
      growth[new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)] = 0;
    }
    (usersRes.data ?? []).forEach((u) => {
      const k = u.created_at.slice(0, 10);
      if (k in growth) growth[k]++;
    });

    // Mood distribution — last 30 days
    const moodDist = { Great: 0, Good: 0, Okay: 0, Low: 0, Unwell: 0 };
    (moodsRes.data ?? []).forEach((m) => {
      const score = Number(m.mood_score);
      const label = score >= 5 ? 'Great' : score === 4 ? 'Good' : score === 3 ? 'Okay' : score === 2 ? 'Low' : 'Unwell';
      moodDist[label]++;
    });

    // Check-in by day of week — last 30 days
    const dowCounts = [0, 0, 0, 0, 0, 0, 0];
    (checkInsRes.data ?? []).forEach((c) => { dowCounts[new Date(c.created_at).getDay()]++; });

    // Medicine by category
    const medCat = { prescription: 0, otc: 0, supplement: 0, vitamin: 0, other: 0 };
    (medsRes.data ?? []).forEach((m) => { if (m.category in medCat) medCat[m.category]++; });

    // AI messages by day — last 7 days
    const aiByDay = {};
    for (let i = 6; i >= 0; i--) {
      aiByDay[new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)] = 0;
    }
    (aiRes.data ?? [])
      .filter((a) => a.role === 'user')
      .forEach((a) => {
        const k = a.created_at.slice(0, 10);
        if (k in aiByDay) aiByDay[k]++;
      });

    // Care events by type
    const careDist = { Doctor: 0, Family: 0, Medicine: 0, Wellness: 0 };
    (careRes.data ?? []).forEach((c) => { if (c.type in careDist) careDist[c.type]++; });

    // Mind games — average score per game type
    const gameBuckets = {};
    (gamesRes.data ?? []).forEach((g) => {
      if (!gameBuckets[g.game_type]) gameBuckets[g.game_type] = { sum: 0, n: 0 };
      gameBuckets[g.game_type].sum += g.score;
      gameBuckets[g.game_type].n++;
    });
    const gameAvg = {};
    Object.entries(gameBuckets).forEach(([k, v]) => {
      gameAvg[k] = v.n ? Math.round(v.sum / v.n) : 0;
    });

    return res.json({
      user_growth:     { labels: Object.keys(growth),   data: Object.values(growth) },
      mood_dist:       { labels: Object.keys(moodDist), data: Object.values(moodDist) },
      check_in_dow:    { labels: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], data: dowCounts },
      med_category:    { labels: Object.keys(medCat),   data: Object.values(medCat) },
      ai_by_day:       { labels: Object.keys(aiByDay),  data: Object.values(aiByDay) },
      care_by_type:    { labels: Object.keys(careDist), data: Object.values(careDist) },
      game_avg_scores: { labels: Object.keys(gameAvg),  data: Object.values(gameAvg) },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ── Users ───────────────────────────────────────────────────────────────────

// GET /admin/api/users
const getUsers = async (req, res) => {
  const { role, search, status, page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const fullSelect = 'id,full_name,email,mobile,role,country,age,biological_sex,is_banned,last_active,created_at';
  const safeSelect = 'id,full_name,email,mobile,role,country,age,biological_sex,created_at';

  const buildQuery = (select) => {
    const params = new URLSearchParams();
    params.set('select', select);
    params.set('order', 'created_at.desc');
    params.set('limit', String(limitNum));
    params.set('offset', String(offset));
    if (role) params.set('role', `eq.${role}`);
    if (status === 'suspended') params.set('is_banned', 'eq.true');
    else if (status === 'active') params.set('is_banned', 'eq.false');

    const term = String(search ?? '').trim();
    if (term) {
      const pattern = `*${term.replace(/[*,()]/g, '')}*`;
      params.set('or', `(full_name.ilike.${pattern},email.ilike.${pattern},mobile.ilike.${pattern})`);
    }

    return `/profiles?${params.toString()}`;
  };

  try {
    let endpoint = buildQuery(fullSelect);
    let result = await supabaseAdmin(endpoint, {
      headers: { Prefer: 'count=exact' },
    });

    if (!result.ok) {
      console.warn('[admin] getUsers full select failed, falling back:', result.data?.message);
      endpoint = buildQuery(safeSelect);
      result = await supabaseAdmin(endpoint, {
        headers: { Prefer: 'count=exact' },
      });
    }

    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.data?.message ?? 'Database query failed' });
    }

    let users = (result.data ?? []).map((u) => ({ ...u, is_banned: u.is_banned ?? false }));
    users = await attachConnectionCounts(users, role);
    const total = parseContentRangeTotal(result.contentRange) ?? users.length;

    return res.json({
      success: true,
      users,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// GET /admin/api/users/incomplete — app_users without profiles (OTP-only signups)
const getIncompleteUsers = async (req, res) => {
  const { page = '1', limit = '20' } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  try {
    const endpoint =
      `/app_users?select=id,phone_e164,email,created_at,profiles(id)` +
      `&profiles=is.null&order=created_at.desc&limit=${limitNum}&offset=${offset}`;
    const result = await supabaseAdmin(endpoint, { headers: { Prefer: 'count=exact' } });
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.data?.message ?? 'Query failed' });
    }

    const users = (result.data ?? []).map((row) => ({
      id: row.id,
      full_name: null,
      email: row.email,
      mobile: row.phone_e164,
      role: 'pending',
      country: null,
      age: null,
      biological_sex: null,
      is_banned: false,
      last_active: null,
      created_at: row.created_at,
      profile_incomplete: true,
    }));

    return res.json({
      success: true,
      users,
      total: parseContentRangeTotal(result.contentRange) ?? users.length,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// GET /admin/api/users/export
const exportUsers = async (req, res) => {
  const { role, status } = req.query;
  const params = new URLSearchParams();
  params.set('select', 'id,full_name,email,mobile,role,country,age,is_banned,created_at,last_active');
  params.set('order', 'created_at.desc');
  params.set('limit', '5000');
  if (role) params.set('role', `eq.${role}`);
  if (status === 'suspended') params.set('is_banned', 'eq.true');
  else if (status === 'active') params.set('is_banned', 'eq.false');

  try {
    const result = await supabaseAdmin(`/profiles?${params.toString()}`);
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.data?.message ?? 'Export failed' });
    }

    const rows = result.data ?? [];
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
    return res.status(500).json({ success: false, error: err.message });
  }
};

// GET /admin/api/users/:id
const getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const [profileRes, appUser, linksAsGuardian, linksAsElder] = await Promise.all([
      supabaseAdmin(`/profiles?id=eq.${id}&select=*`),
      findAppUserById(id),
      supabaseAdmin(`/guardian_elder_links?guardian_id=eq.${id}&select=*&order=created_at.desc`),
      supabaseAdmin(`/guardian_elder_links?elder_id=eq.${id}&select=*&order=created_at.desc`),
    ]);

    const profile = profileRes.data?.[0] ?? null;
    if (!profile && !appUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const linkIds = [
      ...(linksAsGuardian.data ?? []).map((l) => l.elder_id).filter(Boolean),
      ...(linksAsElder.data ?? []).map((l) => l.guardian_id),
    ];
    const userMap = await fetchUserMap([...new Set(linkIds)]);

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
        as_guardian: (linksAsGuardian.data ?? []).map(enrichLink),
        as_elder: (linksAsElder.data ?? []).map(enrichLink),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// POST /admin/api/users
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

    const profileRes = await supabaseAdmin('/profiles', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(profilePayload),
    });

    if (!profileRes.ok) {
      const upsertRes = await supabaseAdmin(`/profiles?id=eq.${appUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify(profilePayload),
      });
      if (!upsertRes.ok) {
        return res.status(500).json({ success: false, error: profileRes.data?.message ?? 'Profile create failed' });
      }
      return res.status(201).json({ success: true, profile: upsertRes.data?.[0], app_user: appUser });
    }

    return res.status(201).json({
      success: true,
      profile: profileRes.data?.[0] ?? profilePayload,
      app_user: appUser,
    });
  } catch (err) {
    if (err.code === 'USER_EXISTS') {
      return res.status(409).json({ success: false, error: 'User already exists' });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
};

// PATCH /admin/api/users/:id
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
    const result = await supabaseAdmin(`/profiles?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.data?.message ?? 'Update failed' });
    }
    return res.json({ success: true, profile: result.data?.[0] ?? null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// PATCH /admin/api/users/:id/ban
const banUser = async (req, res) => {
  const { id } = req.params;
  const { banned } = req.body;
  try {
    const result = await supabaseAdmin(`/profiles?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_banned: !!banned }),
    });
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.data?.message ?? 'Update failed. Run migration 054 to add the is_banned column.' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /admin/api/users/:id
const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const appUser = await findAppUserById(id);
    if (appUser) {
      await deleteAppUser(id);
      return res.json({ success: true });
    }

    // Legacy fallback: profile without app_users row
    const profileRes = await supabaseAdmin(`/profiles?id=eq.${id}`, { method: 'DELETE' });
    if (!profileRes.ok) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Connections ─────────────────────────────────────────────────────────────

// GET /admin/api/connections
const getConnections = async (req, res) => {
  const { status, page = 1, limit = 20, search } = req.query;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const params = new URLSearchParams();
  params.set(
    'select',
    'id,guardian_id,elder_id,elder_email,parent_name,relation,status,created_at,guardian:profiles!guardian_id(full_name,email),elder:profiles!elder_id(full_name,email)',
  );
  params.set('order', 'created_at.desc');
  params.set('limit', String(limitNum));
  params.set('offset', String(offset));
  if (status) params.set('status', `eq.${status}`);

  const term = String(search ?? '').trim();
  if (term) {
    const pattern = `*${term.replace(/[*,()]/g, '')}*`;
    params.set('or', `(elder_email.ilike.${pattern},parent_name.ilike.${pattern},relation.ilike.${pattern})`);
  }

  try {
    const linksRes = await supabaseAdmin(`/guardian_elder_links?${params.toString()}`, {
      headers: { Prefer: 'count=exact' },
    });
    if (!linksRes.ok) {
      console.error('[admin] getConnections failed:', linksRes.data);
      return res.status(500).json({ success: false, error: linksRes.data?.message ?? 'Query failed' });
    }

    const enriched = (linksRes.data ?? []).map((link) => ({
      id: link.id,
      guardian_id: link.guardian_id,
      elder_id: link.elder_id,
      elder_email: link.elder_email,
      parent_name: link.parent_name,
      relation: link.relation,
      status: link.status,
      created_at: link.created_at,
      guardian_name: link.guardian?.full_name ?? '—',
      guardian_email: link.guardian?.email ?? '—',
      elder_name: link.elder?.full_name ?? '—',
    }));

    return res.json({
      success: true,
      connections: enriched,
      total: parseContentRangeTotal(linksRes.contentRange) ?? enriched.length,
      page: pageNum,
      limit: limitNum,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// PATCH /admin/api/connections/:id
const updateConnection = async (req, res) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!['connected', 'declined', 'pending'].includes(status)) {
    return res.status(400).json({ success: false, error: 'Invalid status' });
  }

  try {
    const result = await supabaseAdmin(`/guardian_elder_links?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
    });
    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.data?.message ?? 'Update failed' });
    }
    return res.json({ success: true, connection: result.data?.[0] ?? null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// DELETE /admin/api/connections/:id
const deleteConnection = async (req, res) => {
  const { id } = req.params;
  try {
    await supabaseAdmin(`/guardian_elder_links?id=eq.${id}`, { method: 'DELETE' });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Medicines ────────────────────────────────────────────────────────────────

// GET /admin/api/medicines
const getMedicines = async (req, res) => {
  const { page = 1, limit = 20, category, priority, active } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let endpoint =
    `/medicines?select=id,user_id,name,category,priority,schedule_time,frequency,is_active,stock,start_date,end_date,created_at` +
    `&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (category) endpoint += `&category=eq.${category}`;
  if (priority) endpoint += `&priority=eq.${priority}`;
  if (active !== undefined && active !== '') endpoint += `&is_active=eq.${active}`;

  try {
    const medsRes = await supabaseAdmin(endpoint);
    const meds = medsRes.data ?? [];
    const userMap = await fetchUserMap([...new Set(meds.map((m) => m.user_id))]);
    const enriched = meds.map((m) => ({
      ...m,
      user_name:  userMap[m.user_id]?.full_name ?? '—',
      user_email: userMap[m.user_id]?.email     ?? '—',
    }));
    return res.json({ success: true, medicines: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Daily Check-ins ──────────────────────────────────────────────────────────

// GET /admin/api/check-ins
const getCheckIns = async (req, res) => {
  const { page = 1, limit = 20, mood } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let endpoint =
    `/daily_checkins?select=id,user_id,created_at,mood_score,sleep_quality,sleep_hours,energy_level,pain_level,medicines_taken,physical_activity,created_at` +
    `&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (mood) endpoint += `&mood=eq.${mood}`;

  try {
    const ciRes = await supabaseAdmin(endpoint);
    const rows = ciRes.data ?? [];
    const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
    const enriched = rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
    return res.json({ success: true, check_ins: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Moods ────────────────────────────────────────────────────────────────────

// GET /admin/api/moods
const getMoods = async (req, res) => {
  const { page = 1, limit = 20, mood } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let endpoint =
    `/mood_entries?select=id,user_id,mood_score,note,created_at` +
    `&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (mood) endpoint += `&mood=eq.${mood}`;

  try {
    const moodsRes = await supabaseAdmin(endpoint);
    const rows = moodsRes.data ?? [];
    const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
    const enriched = rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
    return res.json({ success: true, moods: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── AI Conversations ─────────────────────────────────────────────────────────

// GET /admin/api/ai-conversations
const getAIConversations = async (req, res) => {
  const { page = 1, limit = 20, role } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let endpoint =
    `/ai_conversations?select=id,user_id,role,content,created_at` +
    `&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (role) endpoint += `&role=eq.${role}`;

  try {
    const aiRes = await supabaseAdmin(endpoint);
    const rows = aiRes.data ?? [];
    const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
    const enriched = rows.map((r) => ({
      ...r,
      user_name:       userMap[r.user_id]?.full_name ?? '—',
      content_preview: (r.content ?? '').slice(0, 120),
    }));
    return res.json({ success: true, conversations: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Care Events ───────────────────────────────────────────────────────────────

// GET /admin/api/care-events
const getCareEvents = async (req, res) => {
  const { page = 1, limit = 20, type } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let endpoint =
    `/care_events?select=id,user_id,title,sub,type,date,month,year,time,created_at` +
    `&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (type) endpoint += `&type=eq.${type}`;

  try {
    const evRes = await supabaseAdmin(endpoint);
    const rows = evRes.data ?? [];
    const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
    const enriched = rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
    return res.json({ success: true, events: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Mind Games ────────────────────────────────────────────────────────────────

// GET /admin/api/mind-games
const getMindGames = async (req, res) => {
  const { page = 1, limit = 20, game_type } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let endpoint =
    `/mind_games_scores?select=id,user_id,game_type,score,created_at` +
    `&order=score.desc&limit=${limit}&offset=${offset}`;
  if (game_type) endpoint += `&game_type=eq.${game_type}`;

  try {
    const gRes = await supabaseAdmin(endpoint);
    const rows = gRes.data ?? [];
    const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
    const enriched = rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
    return res.json({ success: true, scores: enriched });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Broadcast Notification ────────────────────────────────────────────────────

// POST /admin/api/broadcast
const broadcast = async (req, res) => {
  const { title, body } = req.body ?? {};
  if (!title || !body) {
    return res.status(400).json({ success: false, error: 'title and body are required' });
  }

  try {
    const usersRes = await supabaseAdmin('/profiles?select=id&is_banned=eq.false');
    const userIds = (usersRes.data ?? []).map((u) => u.id);
    if (!userIds.length) return res.json({ success: true, sent: 0 });

    const records = userIds.map((uid) => ({
      user_id:   uid,
      sender_id: null,
      type:      'announcement',
      title,
      body,
      data:      { source: 'admin_broadcast' },
      read:      false,
    }));

    // Insert in batches of 100
    for (let i = 0; i < records.length; i += 100) {
      await supabaseAdmin('/notifications', {
        method: 'POST',
        body: JSON.stringify(records.slice(i, i + 100)),
      });
    }

    return res.json({ success: true, sent: userIds.length });
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
