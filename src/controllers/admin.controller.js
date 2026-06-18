const crypto = require('crypto');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// In-memory session store: token → expiry timestamp
const sessions = new Map();

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
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
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
  const expiry = sessions.get(token);
  if (!expiry || Date.now() > expiry) {
    sessions.delete(token);
    return false;
  }
  return true;
};

// POST /admin/api/login
const login = (req, res) => {
  const { username, password } = req.body ?? {};
  const validUser = process.env.ADMIN_USERNAME ?? 'admin';
  const validPass = process.env.ADMIN_PASSWORD ?? 'tinybit2025';
  if (username === validUser && password === validPass) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + 24 * 60 * 60 * 1000);
    return res.json({ success: true, token });
  }
  return res.status(401).json({ success: false, error: 'Invalid credentials' });
};

// POST /admin/api/logout
const logout = (req, res) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) sessions.delete(auth.slice(7));
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
  const { role, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const base = `&order=created_at.desc&limit=${limit}&offset=${offset}` + (role ? `&role=eq.${role}` : '');

  // Try full select first; fall back to safe columns if is_banned doesn't exist yet
  const fullSelect = `id,full_name,email,role,country,age,biological_sex,is_banned,last_active,created_at`;
  const safeSelect = `id,full_name,email,role,country,age,biological_sex,created_at`;

  try {
    let result = await supabaseAdmin(`/profiles?select=${fullSelect}${base}`);

    if (!result.ok) {
      console.warn('[admin] getUsers full select failed, falling back:', result.data?.message);
      result = await supabaseAdmin(`/profiles?select=${safeSelect}${base}`);
    }

    if (!result.ok) {
      return res.status(500).json({ success: false, error: result.data?.message ?? 'Database query failed' });
    }

    let users = (result.data ?? []).map((u) => ({ ...u, is_banned: u.is_banned ?? false }));

    if (search) {
      const q = search.toLowerCase();
      users = users.filter(
        (u) => u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q),
      );
    }

    return res.json({ success: true, users });
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
    // Delete auth user — cascades to profiles and all app data
    const authResult = await supabaseAuthAdmin(`/users/${id}`, { method: 'DELETE' });
    if (!authResult.ok && authResult.status !== 404) {
      // Fallback: delete only the profile row
      await supabaseAdmin(`/profiles?id=eq.${id}`, { method: 'DELETE' });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

// ── Connections ─────────────────────────────────────────────────────────────

// GET /admin/api/connections
const getConnections = async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let endpoint =
    `/guardian_elder_links?select=id,guardian_id,elder_id,elder_email,parent_name,relation,status,created_at` +
    `&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (status) endpoint += `&status=eq.${status}`;

  try {
    const linksRes = await supabaseAdmin(endpoint);
    if (!linksRes.ok) {
      console.error('[admin] getConnections failed:', linksRes.data);
      return res.status(500).json({ success: false, error: linksRes.data?.message ?? 'Query failed' });
    }
    const links = linksRes.data ?? [];

    const enriched = await Promise.all(
      links.map(async (link) => {
        const [gRes, eRes] = await Promise.all([
          supabaseAdmin(`/profiles?id=eq.${link.guardian_id}&select=full_name,email`),
          link.elder_id
            ? supabaseAdmin(`/profiles?id=eq.${link.elder_id}&select=full_name,email`)
            : Promise.resolve({ data: [] }),
        ]);
        return {
          ...link,
          guardian_name:  gRes.data?.[0]?.full_name ?? '—',
          guardian_email: gRes.data?.[0]?.email     ?? '—',
          elder_name:     eRes.data?.[0]?.full_name ?? '—',
        };
      }),
    );

    return res.json({ success: true, connections: enriched });
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
  getUsers, banUser, deleteUser,
  getConnections, deleteConnection,
  getMedicines,
  getCheckIns,
  getMoods,
  getAIConversations,
  getCareEvents,
  getMindGames,
  broadcast,
};
