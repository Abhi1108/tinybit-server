const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function fetchUserMap(userIds) {
  if (!userIds.length) return {};
  const res = await supabaseAdmin(
    `/profiles?id=in.(${userIds.join(',')})&select=id,full_name,email`,
  );
  const map = {};
  (res.data ?? []).forEach((u) => { map[u.id] = u; });
  return map;
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

async function getDashboardStats() {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

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

  return {
    elders: eldersRes.data?.length ?? 0,
    guardians: guardiansRes.data?.length ?? 0,
    active_connections: connectedRes.data?.length ?? 0,
    pending_invitations: pendingRes.data?.length ?? 0,
    new_this_week: weekRes.data?.length ?? 0,
    active_medicines: medsRes.data?.length ?? 0,
    check_ins_today: checkInRes.data?.length ?? 0,
    moods_this_week: moodRes.data?.length ?? 0,
    ai_messages_today: aiRes.data?.length ?? 0,
  };
}

async function getAnalytics() {
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

  const growth = {};
  for (let i = 29; i >= 0; i--) {
    growth[new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)] = 0;
  }
  (usersRes.data ?? []).forEach((u) => {
    const k = u.created_at.slice(0, 10);
    if (k in growth) growth[k]++;
  });

  const moodDist = { Great: 0, Good: 0, Okay: 0, Low: 0, Unwell: 0 };
  (moodsRes.data ?? []).forEach((m) => {
    const score = Number(m.mood_score);
    const label = score >= 5 ? 'Great' : score === 4 ? 'Good' : score === 3 ? 'Okay' : score === 2 ? 'Low' : 'Unwell';
    moodDist[label]++;
  });

  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  (checkInsRes.data ?? []).forEach((c) => { dowCounts[new Date(c.created_at).getDay()]++; });

  const medCat = { prescription: 0, otc: 0, supplement: 0, vitamin: 0, other: 0 };
  (medsRes.data ?? []).forEach((m) => { if (m.category in medCat) medCat[m.category]++; });

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

  const careDist = { Doctor: 0, Family: 0, Medicine: 0, Wellness: 0 };
  (careRes.data ?? []).forEach((c) => { if (c.type in careDist) careDist[c.type]++; });

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

  return {
    user_growth: { labels: Object.keys(growth), data: Object.values(growth) },
    mood_dist: { labels: Object.keys(moodDist), data: Object.values(moodDist) },
    check_in_dow: { labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], data: dowCounts },
    med_category: { labels: Object.keys(medCat), data: Object.values(medCat) },
    ai_by_day: { labels: Object.keys(aiByDay), data: Object.values(aiByDay) },
    care_by_type: { labels: Object.keys(careDist), data: Object.values(careDist) },
    game_avg_scores: { labels: Object.keys(gameAvg), data: Object.values(gameAvg) },
  };
}

async function getUsers({ role, search, status, page, limit }) {
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

  let endpoint = buildQuery(fullSelect);
  let result = await supabaseAdmin(endpoint, { headers: { Prefer: 'count=exact' } });

  if (!result.ok) {
    endpoint = buildQuery(safeSelect);
    result = await supabaseAdmin(endpoint, { headers: { Prefer: 'count=exact' } });
  }

  if (!result.ok) {
    const err = new Error(result.data?.message ?? 'Database query failed');
    err.status = 500;
    throw err;
  }

  let users = (result.data ?? []).map((u) => ({ ...u, is_banned: u.is_banned ?? false }));
  users = await attachConnectionCounts(users, role);
  const total = parseContentRangeTotal(result.contentRange) ?? users.length;

  return { users, total, page: pageNum, limit: limitNum };
}

async function getIncompleteUsers({ page, limit }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const endpoint =
    `/app_users?select=id,phone_e164,email,created_at,profiles(id)` +
    `&profiles=is.null&order=created_at.desc&limit=${limitNum}&offset=${offset}`;
  const result = await supabaseAdmin(endpoint, { headers: { Prefer: 'count=exact' } });

  if (!result.ok) {
    const err = new Error(result.data?.message ?? 'Query failed');
    err.status = 500;
    throw err;
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

  return {
    users,
    total: parseContentRangeTotal(result.contentRange) ?? users.length,
    page: pageNum,
    limit: limitNum,
  };
}

async function exportUsers({ role, status }) {
  const params = new URLSearchParams();
  params.set('select', 'id,full_name,email,mobile,role,country,age,is_banned,created_at,last_active');
  params.set('order', 'created_at.desc');
  params.set('limit', '5000');
  if (role) params.set('role', `eq.${role}`);
  if (status === 'suspended') params.set('is_banned', 'eq.true');
  else if (status === 'active') params.set('is_banned', 'eq.false');

  const result = await supabaseAdmin(`/profiles?${params.toString()}`);
  if (!result.ok) {
    const err = new Error(result.data?.message ?? 'Export failed');
    err.status = 500;
    throw err;
  }

  return result.data ?? [];
}

async function getProfileById(id) {
  const result = await supabaseAdmin(`/profiles?id=eq.${id}&select=*`);
  if (!result.ok) {
    const err = new Error(result.data?.message ?? 'Profile lookup failed');
    err.status = 500;
    throw err;
  }
  return result.data?.[0] ?? null;
}

async function getGuardianLinksByGuardianId(id) {
  const result = await supabaseAdmin(
    `/guardian_elder_links?guardian_id=eq.${id}&select=*&order=created_at.desc`,
  );
  if (!result.ok) throw new Error(result.data?.message ?? 'Link lookup failed');
  return result.data ?? [];
}

async function getGuardianLinksByElderId(id) {
  const result = await supabaseAdmin(
    `/guardian_elder_links?elder_id=eq.${id}&select=*&order=created_at.desc`,
  );
  if (!result.ok) throw new Error(result.data?.message ?? 'Link lookup failed');
  return result.data ?? [];
}

async function upsertProfile(profilePayload) {
  const profileRes = await supabaseAdmin('/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(profilePayload),
  });

  if (profileRes.ok) {
    return profileRes.data?.[0] ?? profilePayload;
  }

  const upsertRes = await supabaseAdmin(`/profiles?id=eq.${profilePayload.id}`, {
    method: 'PATCH',
    body: JSON.stringify(profilePayload),
  });

  if (!upsertRes.ok) {
    const err = new Error(profileRes.data?.message ?? 'Profile create failed');
    err.status = 500;
    throw err;
  }

  return upsertRes.data?.[0] ?? profilePayload;
}

async function updateProfile(id, patch) {
  const result = await supabaseAdmin(`/profiles?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  if (!result.ok) {
    const err = new Error(result.data?.message ?? 'Update failed');
    err.status = 500;
    throw err;
  }
  return result.data?.[0] ?? null;
}

async function deleteProfile(id) {
  const result = await supabaseAdmin(`/profiles?id=eq.${id}`, { method: 'DELETE' });
  if (!result.ok) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
}

async function getConnections({ status, page, limit, search }) {
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

  const linksRes = await supabaseAdmin(`/guardian_elder_links?${params.toString()}`, {
    headers: { Prefer: 'count=exact' },
  });
  if (!linksRes.ok) {
    const err = new Error(linksRes.data?.message ?? 'Query failed');
    err.status = 500;
    throw err;
  }

  const connections = (linksRes.data ?? []).map((link) => ({
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

  return {
    connections,
    total: parseContentRangeTotal(linksRes.contentRange) ?? connections.length,
    page: pageNum,
    limit: limitNum,
  };
}

async function updateConnection(id, status) {
  const result = await supabaseAdmin(`/guardian_elder_links?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  });
  if (!result.ok) {
    const err = new Error(result.data?.message ?? 'Update failed');
    err.status = 500;
    throw err;
  }
  return result.data?.[0] ?? null;
}

async function deleteConnection(id) {
  await supabaseAdmin(`/guardian_elder_links?id=eq.${id}`, { method: 'DELETE' });
}

async function getMedicines({ page, limit, category, priority, active }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let endpoint =
    `/medicines?select=id,user_id,name,category,priority,schedule_time,frequency,is_active,stock,start_date,end_date,created_at` +
    `&order=created_at.desc&limit=${limitNum}&offset=${offset}`;
  if (category) endpoint += `&category=eq.${category}`;
  if (priority) endpoint += `&priority=eq.${priority}`;
  if (active !== undefined && active !== '') endpoint += `&is_active=eq.${active}`;

  const medsRes = await supabaseAdmin(endpoint);
  if (!medsRes.ok) throw new Error(medsRes.data?.message ?? 'Query failed');

  const meds = medsRes.data ?? [];
  const userMap = await fetchUserMap([...new Set(meds.map((m) => m.user_id))]);
  return meds.map((m) => ({
    ...m,
    user_name: userMap[m.user_id]?.full_name ?? '—',
    user_email: userMap[m.user_id]?.email ?? '—',
  }));
}

async function getCheckIns({ page, limit, mood }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let endpoint =
    `/daily_checkins?select=id,user_id,created_at,mood_score,sleep_quality,sleep_hours,energy_level,pain_level,medicines_taken,physical_activity,created_at` +
    `&order=created_at.desc&limit=${limitNum}&offset=${offset}`;
  if (mood) endpoint += `&mood=eq.${mood}`;

  const ciRes = await supabaseAdmin(endpoint);
  if (!ciRes.ok) throw new Error(ciRes.data?.message ?? 'Query failed');

  const rows = ciRes.data ?? [];
  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
}

async function getMoods({ page, limit, mood }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let endpoint =
    `/mood_entries?select=id,user_id,mood_score,note,created_at` +
    `&order=created_at.desc&limit=${limitNum}&offset=${offset}`;
  if (mood) endpoint += `&mood=eq.${mood}`;

  const moodsRes = await supabaseAdmin(endpoint);
  if (!moodsRes.ok) throw new Error(moodsRes.data?.message ?? 'Query failed');

  const rows = moodsRes.data ?? [];
  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
}

async function getAIConversations({ page, limit, role }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let endpoint =
    `/ai_conversations?select=id,user_id,role,content,created_at` +
    `&order=created_at.desc&limit=${limitNum}&offset=${offset}`;
  if (role) endpoint += `&role=eq.${role}`;

  const aiRes = await supabaseAdmin(endpoint);
  if (!aiRes.ok) throw new Error(aiRes.data?.message ?? 'Query failed');

  const rows = aiRes.data ?? [];
  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({
    ...r,
    user_name: userMap[r.user_id]?.full_name ?? '—',
    content_preview: (r.content ?? '').slice(0, 120),
  }));
}

async function getCareEvents({ page, limit, type }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let endpoint =
    `/care_events?select=id,user_id,title,sub,type,date,month,year,time,created_at` +
    `&order=created_at.desc&limit=${limitNum}&offset=${offset}`;
  if (type) endpoint += `&type=eq.${type}`;

  const evRes = await supabaseAdmin(endpoint);
  if (!evRes.ok) throw new Error(evRes.data?.message ?? 'Query failed');

  const rows = evRes.data ?? [];
  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
}

async function getMindGames({ page, limit, game_type }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  let endpoint =
    `/mind_games_scores?select=id,user_id,game_type,score,created_at` +
    `&order=score.desc&limit=${limitNum}&offset=${offset}`;
  if (game_type) endpoint += `&game_type=eq.${game_type}`;

  const gRes = await supabaseAdmin(endpoint);
  if (!gRes.ok) throw new Error(gRes.data?.message ?? 'Query failed');

  const rows = gRes.data ?? [];
  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({ ...r, user_name: userMap[r.user_id]?.full_name ?? '—' }));
}

async function broadcastNotification(title, body) {
  const usersRes = await supabaseAdmin('/profiles?select=id&is_banned=eq.false');
  if (!usersRes.ok) throw new Error(usersRes.data?.message ?? 'User lookup failed');

  const userIds = (usersRes.data ?? []).map((u) => u.id);
  if (!userIds.length) return 0;

  const records = userIds.map((uid) => ({
    user_id: uid,
    sender_id: null,
    type: 'announcement',
    title,
    body,
    data: { source: 'admin_broadcast' },
    read: false,
  }));

  for (let i = 0; i < records.length; i += 100) {
    const batch = await supabaseAdmin('/notifications', {
      method: 'POST',
      body: JSON.stringify(records.slice(i, i + 100)),
    });
    if (!batch.ok) throw new Error(batch.data?.message ?? 'Notification insert failed');
  }

  return userIds.length;
}

module.exports = {
  fetchUserMap,
  attachConnectionCounts,
  getDashboardStats,
  getAnalytics,
  getUsers,
  getIncompleteUsers,
  exportUsers,
  getProfileById,
  getGuardianLinksByGuardianId,
  getGuardianLinksByElderId,
  upsertProfile,
  updateProfile,
  deleteProfile,
  getConnections,
  updateConnection,
  deleteConnection,
  getMedicines,
  getCheckIns,
  getMoods,
  getAIConversations,
  getCareEvents,
  getMindGames,
  broadcastNotification,
};
