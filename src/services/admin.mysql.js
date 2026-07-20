const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function toIso(val) {
  if (!val) return val;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function parseJson(val) {
  if (val == null) return val;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    ...row,
    is_banned: !!row.is_banned,
    medical_conditions: parseJson(row.medical_conditions),
    allergies: parseJson(row.allergies),
    created_at: toIso(row.created_at),
    last_active: toIso(row.last_active),
    health_qr_expires_at: toIso(row.health_qr_expires_at),
    plan_started_at: toIso(row.plan_started_at),
    plan_expires_at: toIso(row.plan_expires_at),
    deleted_at: toIso(row.deleted_at),
  };
}

function normalizeRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) out[key] = out[key].toISOString();
    if (key === 'is_active' || key === 'is_banned' || key === 'read' || key === 'medicines_taken') {
      if (out[key] != null) out[key] = !!out[key];
    }
  }
  return out;
}

async function fetchUserMap(userIds) {
  if (!userIds.length) return {};
  const placeholders = userIds.map(() => '?').join(',');
  const rows = await query(
    `SELECT id, full_name, email FROM profiles WHERE id IN (${placeholders})`,
    userIds,
  );
  const map = {};
  rows.forEach((u) => { map[u.id] = u; });
  return map;
}

async function attachConnectionCounts(users, role) {
  if (!users.length) return users;

  const ids = users.map((u) => u.id);
  const placeholders = ids.map(() => '?').join(',');

  if (role === 'guardian') {
    const rows = await query(
      `SELECT guardian_id, COUNT(*) AS cnt
       FROM guardian_elder_links
       WHERE status = 'connected' AND guardian_id IN (${placeholders})
       GROUP BY guardian_id`,
      ids,
    );
    const counts = {};
    rows.forEach((r) => { counts[r.guardian_id] = Number(r.cnt); });
    return users.map((u) => ({ ...u, linked_elder_count: counts[u.id] || 0 }));
  }

  if (role === 'elder') {
    const rows = await query(
      `SELECT elder_id, COUNT(*) AS cnt
       FROM guardian_elder_links
       WHERE status = 'connected' AND elder_id IN (${placeholders})
       GROUP BY elder_id`,
      ids,
    );
    const counts = {};
    rows.forEach((r) => { if (r.elder_id) counts[r.elder_id] = Number(r.cnt); });
    return users.map((u) => ({ ...u, guardian_count: counts[u.id] || 0 }));
  }

  return users;
}

async function countRows(table, whereSql = '', params = []) {
  const rows = await query(
    `SELECT COUNT(*) AS cnt FROM ${table}${whereSql ? ` WHERE ${whereSql}` : ''}`,
    params,
  );
  return Number(rows[0]?.cnt ?? 0);
}

async function getDashboardStats() {
  const yesterday = new Date(Date.now() - 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [
    elders, guardians, active_connections, pending_invitations, new_this_week,
    active_medicines, check_ins_today, moods_this_week, ai_messages_today,
    sos_today, active_subscriptions, active_ai_users,
  ] = await Promise.all([
    countRows('profiles', 'role = ? AND deleted_at IS NULL', ['elder']),
    countRows('profiles', 'role = ? AND deleted_at IS NULL', ['guardian']),
    countRows('guardian_elder_links', 'status = ?', ['connected']),
    countRows('guardian_elder_links', 'status = ?', ['pending']),
    countRows('profiles', 'created_at >= ? AND deleted_at IS NULL', [weekAgo]),
    countRows('medicines', 'is_active = 1'),
    countRows('daily_checkins', 'created_at >= ?', [yesterday]),
    countRows('mood_entries', 'created_at >= ?', [weekAgo]),
    countRows('ai_conversations', 'created_at >= ?', [yesterday]),
    countRows('sos_alerts', 'triggered_at >= ?', [yesterday]),
    countRows('profiles', "deleted_at IS NULL AND role = 'guardian' AND plan_status = 'active'"),
    query(
      `SELECT COUNT(DISTINCT user_id) AS cnt FROM ai_conversations WHERE created_at >= ?`,
      [yesterday],
    ).then((rows) => Number(rows[0]?.cnt ?? 0)),
  ]);

  const [monthRevenueRow] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM payments
     WHERE status = 'captured'
       AND COALESCE(captured_at, created_at) >= ?`,
    [monthStart],
  );

  return {
    elders,
    guardians,
    active_connections,
    pending_invitations,
    new_this_week,
    active_medicines,
    check_ins_today,
    moods_this_week,
    ai_messages_today,
    sos_today,
    active_subscriptions,
    active_ai_users,
    month_revenue: Number(monthRevenueRow?.total) || 0,
  };
}

async function getAnalytics() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const [users, moods, checkIns, meds, ai, care, games] = await Promise.all([
    query('SELECT created_at FROM profiles WHERE created_at >= ?', [thirtyDaysAgo]),
    query('SELECT mood_score, created_at FROM mood_entries WHERE created_at >= ?', [thirtyDaysAgo]),
    query('SELECT created_at FROM daily_checkins WHERE created_at >= ?', [thirtyDaysAgo]),
    query('SELECT category FROM medicines'),
    query('SELECT created_at, role, total_tokens FROM ai_conversations WHERE created_at >= ?', [thirtyDaysAgo]),
    query('SELECT type FROM care_events'),
    query('SELECT game_type, score FROM mind_games_scores'),
  ]);

  const growth = {};
  for (let i = 29; i >= 0; i--) {
    growth[new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)] = 0;
  }
  users.forEach((u) => {
    const k = toIso(u.created_at).slice(0, 10);
    if (k in growth) growth[k]++;
  });

  const moodDist = { Great: 0, Good: 0, Okay: 0, Low: 0, Unwell: 0 };
  moods.forEach((m) => {
    const score = Number(m.mood_score);
    const label = score >= 5 ? 'Great' : score === 4 ? 'Good' : score === 3 ? 'Okay' : score === 2 ? 'Low' : 'Unwell';
    moodDist[label]++;
  });

  const dowCounts = [0, 0, 0, 0, 0, 0, 0];
  checkIns.forEach((c) => { dowCounts[new Date(c.created_at).getDay()]++; });

  const medCat = { prescription: 0, otc: 0, supplement: 0, vitamin: 0, other: 0 };
  meds.forEach((m) => { if (m.category in medCat) medCat[m.category]++; });

  const aiByDay = {};
  const aiTokensByDay = {};
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    aiByDay[day] = 0;
    aiTokensByDay[day] = 0;
  }
  ai.filter((a) => a.role === 'user').forEach((a) => {
    const k = toIso(a.created_at).slice(0, 10);
    if (k in aiByDay) aiByDay[k]++;
  });
  ai.forEach((a) => {
    const k = toIso(a.created_at).slice(0, 10);
    if (k in aiTokensByDay && a.total_tokens != null) {
      aiTokensByDay[k] += Number(a.total_tokens) || 0;
    }
  });

  const careDist = { Doctor: 0, Family: 0, Medicine: 0, Wellness: 0 };
  care.forEach((c) => { if (c.type in careDist) careDist[c.type]++; });

  const gameBuckets = {};
  games.forEach((g) => {
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
    ai_by_day: {
      labels: Object.keys(aiByDay),
      data: Object.values(aiByDay),
      tokens: Object.values(aiTokensByDay),
    },
    care_by_type: { labels: Object.keys(careDist), data: Object.values(careDist) },
    game_avg_scores: { labels: Object.keys(gameAvg), data: Object.values(gameAvg) },
  };
}

function buildUserFilters({ role, search, status, deleted }) {
  const clauses = [];
  const params = [];

  if (deleted === 'only') {
    clauses.push('deleted_at IS NOT NULL');
  } else if (deleted !== 'include') {
    // Default: hide trashed users from every existing listing/export caller.
    clauses.push('deleted_at IS NULL');
  }

  if (role) {
    clauses.push('role = ?');
    params.push(role);
  }
  if (status === 'suspended') {
    clauses.push('is_banned = 1');
  } else if (status === 'active') {
    clauses.push('is_banned = 0');
  }

  const term = String(search ?? '').trim();
  if (term) {
    const like = `%${term.replace(/[%_]/g, '')}%`;
    clauses.push('(full_name LIKE ? OR email LIKE ? OR mobile LIKE ?)');
    params.push(like, like, like);
  }

  return { where: clauses.length ? clauses.join(' AND ') : '1=1', params };
}

async function getUsers({ role, search, status, page, limit, deleted }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const { where, params } = buildUserFilters({ role, search, status, deleted });

  const [totalRows, rows] = await Promise.all([
    query(`SELECT COUNT(*) AS cnt FROM profiles WHERE ${where}`, params),
    query(
      `SELECT id, full_name, email, mobile, role, country, age, biological_sex,
              is_banned, last_active, created_at, deleted_at, deleted_by
       FROM profiles
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    ),
  ]);

  let users = rows.map((u) => normalizeProfile(u));
  users = await attachConnectionCounts(users, role);

  return {
    users,
    total: Number(totalRows[0]?.cnt ?? users.length),
    page: pageNum,
    limit: limitNum,
  };
}

async function getIncompleteUsers({ page, limit }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const [totalRows, rows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS cnt
       FROM app_users au
       LEFT JOIN profiles p ON p.id = au.id
       WHERE p.id IS NULL`,
    ),
    query(
      `SELECT au.id, au.phone_e164, au.email, au.created_at
       FROM app_users au
       LEFT JOIN profiles p ON p.id = au.id
       WHERE p.id IS NULL
       ORDER BY au.created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
    ),
  ]);

  const users = rows.map((row) => ({
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
    created_at: toIso(row.created_at),
    profile_incomplete: true,
  }));

  return {
    users,
    total: Number(totalRows[0]?.cnt ?? users.length),
    page: pageNum,
    limit: limitNum,
  };
}

async function exportUsers({ role, status }) {
  const { where, params } = buildUserFilters({ role, search: '', status });
  const rows = await query(
    `SELECT id, full_name, email, mobile, role, country, age, is_banned, created_at, last_active
     FROM profiles
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT 5000`,
    params,
  );
  return rows.map((r) => normalizeProfile(r));
}

async function getProfileById(id) {
  const rows = await query('SELECT * FROM profiles WHERE id = ? LIMIT 1', [id]);
  return normalizeProfile(rows[0]);
}

async function getGuardianLinksByGuardianId(id) {
  const rows = await query(
    'SELECT * FROM guardian_elder_links WHERE guardian_id = ? ORDER BY created_at DESC',
    [id],
  );
  return rows.map(normalizeRow);
}

async function getGuardianLinksByElderId(id) {
  const rows = await query(
    'SELECT * FROM guardian_elder_links WHERE elder_id = ? ORDER BY created_at DESC',
    [id],
  );
  return rows.map(normalizeRow);
}

const PROFILE_COLUMNS = new Set([
  'id', 'first_name', 'last_name', 'full_name', 'email', 'mobile', 'role',
  'date_of_birth', 'age', 'country', 'country_code', 'location', 'preferred_language',
  'profile_image', 'blood_group', 'height', 'height_unit', 'weight', 'weight_unit',
  'biological_sex', 'medical_conditions', 'emergency_phone', 'emergency_name',
  'emergency_relation', 'family_code', 'push_token', 'plan_type', 'plan_status',
  'plan_started_at', 'plan_expires_at', 'plan_amount', 'plan_currency', 'plan_interval',
  'streak', 'is_banned', 'last_active', 'health_qr_token', 'health_qr_expires_at',
  'allergies', 'other_condition', 'doctor_name', 'doctor_contact',
]);

function serializeProfileValue(key, value) {
  if (value === undefined) return undefined;
  if ((key === 'medical_conditions' || key === 'allergies') && value != null && typeof value !== 'string') {
    return JSON.stringify(value);
  }
  if (key === 'is_banned') return value ? 1 : 0;
  if ((key === 'health_qr_expires_at' || key === 'last_active' || key === 'plan_started_at' || key === 'plan_expires_at') && value) {
    return new Date(value);
  }
  return value;
}

async function upsertProfile(profilePayload) {
  const cols = Object.keys(profilePayload).filter((k) => PROFILE_COLUMNS.has(k));
  if (!cols.length) {
    const err = new Error('No valid profile fields');
    err.status = 400;
    throw err;
  }

  const values = cols.map((k) => serializeProfileValue(k, profilePayload[k]));
  const placeholders = cols.map(() => '?').join(', ');
  const updates = cols.filter((k) => k !== 'id').map((k) => `${k} = VALUES(${k})`).join(', ');

  await execute(
    `INSERT INTO profiles (${cols.join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
    values,
  );

  return getProfileById(profilePayload.id);
}

async function updateProfile(id, patch) {
  const entries = Object.entries(patch).filter(([k]) => PROFILE_COLUMNS.has(k) && k !== 'id');
  if (!entries.length) return getProfileById(id);

  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  const params = entries.map(([k, v]) => serializeProfileValue(k, v));

  const result = await execute(
    `UPDATE profiles SET ${sets} WHERE id = ?`,
    [...params, id],
  );

  if (result.affectedRows === 0) {
    const err = new Error('Update failed');
    err.status = 500;
    throw err;
  }

  return getProfileById(id);
}

async function deleteProfile(id) {
  const result = await execute('DELETE FROM profiles WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
}

// Deletion state is a dedicated action (its own audited endpoint), not a generic
// admin-editable field — deliberately NOT routed through PROFILE_COLUMNS/updateProfile
// so a stray PATCH body can never silently trash/restore a user outside the audit trail.
async function softDeleteProfile(id, actor) {
  const result = await execute(
    `UPDATE profiles SET deleted_at = CURRENT_TIMESTAMP(3), deleted_by = ?
     WHERE id = ? AND deleted_at IS NULL`,
    [actor, id],
  );
  if (result.affectedRows === 0) {
    const err = new Error('User not found or already deleted');
    err.status = 404;
    throw err;
  }
  return getProfileById(id);
}

async function restoreProfile(id) {
  const result = await execute(
    `UPDATE profiles SET deleted_at = NULL, deleted_by = NULL
     WHERE id = ? AND deleted_at IS NOT NULL`,
    [id],
  );
  if (result.affectedRows === 0) {
    const err = new Error('User not found or not in trash');
    err.status = 404;
    throw err;
  }
  return getProfileById(id);
}

async function getDeletedProfile(id) {
  const rows = await query('SELECT id, deleted_at FROM profiles WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

async function getConnections({ status, page, limit, search }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];

  if (status) {
    clauses.push('gel.status = ?');
    params.push(status);
  }

  const term = String(search ?? '').trim();
  if (term) {
    const like = `%${term.replace(/[%_]/g, '')}%`;
    clauses.push('(gel.elder_email LIKE ? OR gel.parent_name LIKE ? OR gel.relation LIKE ?)');
    params.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const [totalRows, rows] = await Promise.all([
    query(
      `SELECT COUNT(*) AS cnt
       FROM guardian_elder_links gel
       ${where}`,
      params,
    ),
    query(
      `SELECT gel.id, gel.guardian_id, gel.elder_id, gel.elder_email, gel.parent_name,
              gel.relation, gel.status, gel.created_at,
              gp.full_name AS guardian_full_name, gp.email AS guardian_email,
              ep.full_name AS elder_full_name
       FROM guardian_elder_links gel
       LEFT JOIN profiles gp ON gp.id = gel.guardian_id
       LEFT JOIN profiles ep ON ep.id = gel.elder_id
       ${where}
       ORDER BY gel.created_at DESC
       LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    ),
  ]);

  const connections = rows.map((link) => ({
    id: link.id,
    guardian_id: link.guardian_id,
    elder_id: link.elder_id,
    elder_email: link.elder_email,
    parent_name: link.parent_name,
    relation: link.relation,
    status: link.status,
    created_at: toIso(link.created_at),
    guardian_name: link.guardian_full_name ?? '—',
    guardian_email: link.guardian_email ?? '—',
    elder_name: link.elder_full_name ?? '—',
  }));

  return {
    connections,
    total: Number(totalRows[0]?.cnt ?? connections.length),
    page: pageNum,
    limit: limitNum,
  };
}

async function updateConnection(id, status) {
  const result = await execute(
    `UPDATE guardian_elder_links SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
    [status, id],
  );
  if (result.affectedRows === 0) {
    const err = new Error('Update failed');
    err.status = 500;
    throw err;
  }
  const rows = await query('SELECT * FROM guardian_elder_links WHERE id = ? LIMIT 1', [id]);
  return normalizeRow(rows[0]);
}

async function deleteConnection(id) {
  await execute('DELETE FROM guardian_elder_links WHERE id = ?', [id]);
}

async function getMedicines({ page, limit, category, priority, active }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (category) { clauses.push('category = ?'); params.push(category); }
  if (priority) { clauses.push('priority = ?'); params.push(priority); }
  if (active !== undefined && active !== '') {
    clauses.push('is_active = ?');
    params.push(active === 'true' || active === true ? 1 : 0);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT id, user_id, name, category, priority, schedule_time, frequency,
            is_active, stock, start_date, end_date, created_at
     FROM medicines
     ${where}
     ORDER BY created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  const userMap = await fetchUserMap([...new Set(rows.map((m) => m.user_id))]);
  return rows.map((m) => ({
    ...normalizeRow(m),
    user_name: userMap[m.user_id]?.full_name ?? '—',
    user_email: userMap[m.user_id]?.email ?? '—',
  }));
}

async function getCheckIns({ page, limit, mood }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const params = [];
  let where = '';
  if (mood) {
    where = 'WHERE mood = ?';
    params.push(mood);
  }

  const rows = await query(
    `SELECT id, user_id, created_at, mood_score, sleep_quality, sleep_hours,
            energy_level, pain_level, medicines_taken, physical_activity
     FROM daily_checkins
     ${where}
     ORDER BY created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({
    ...normalizeRow(r),
    user_name: userMap[r.user_id]?.full_name ?? '—',
  }));
}

async function getMoods({ page, limit, mood }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const params = [];
  let where = '';
  if (mood) {
    where = 'WHERE mood = ?';
    params.push(mood);
  }

  const rows = await query(
    `SELECT id, user_id, mood_score, note, created_at
     FROM mood_entries
     ${where}
     ORDER BY created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({
    ...normalizeRow(r),
    user_name: userMap[r.user_id]?.full_name ?? '—',
  }));
}

async function getAIConversations({ page, limit, role }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const params = [];
  let where = '';
  if (role) {
    where = 'WHERE role = ?';
    params.push(role);
  }

  const rows = await query(
    `SELECT id, user_id, role, content, provider,
            prompt_tokens, completion_tokens, total_tokens, created_at
     FROM ai_conversations
     ${where}
     ORDER BY created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({
    ...normalizeRow(r),
    user_name: userMap[r.user_id]?.full_name ?? '—',
    content_preview: (r.content ?? '').slice(0, 120),
    prompt_tokens: r.prompt_tokens == null ? null : Number(r.prompt_tokens),
    completion_tokens: r.completion_tokens == null ? null : Number(r.completion_tokens),
    total_tokens: r.total_tokens == null ? null : Number(r.total_tokens),
  }));
}

async function getCareEvents({ page, limit, type, user_id }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const params = [];
  const clauses = [];
  if (type) {
    clauses.push('type = ?');
    params.push(type);
  }
  if (user_id) {
    clauses.push('user_id = ?');
    params.push(user_id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT id, user_id, title, sub, type, date, month, year, time, color, emoji, timestamp, created_at
     FROM care_events
     ${where}
     ORDER BY timestamp DESC, created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({
    ...normalizeRow(r),
    timestamp: r.timestamp == null ? null : Number(r.timestamp),
    user_name: userMap[r.user_id]?.full_name ?? '—',
  }));
}

async function getMindGames({ page, limit, game_type }) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const params = [];
  let where = '';
  if (game_type) {
    where = 'WHERE game_type = ?';
    params.push(game_type);
  }

  const rows = await query(
    `SELECT id, user_id, game_type, score, created_at
     FROM mind_games_scores
     ${where}
     ORDER BY score DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return rows.map((r) => ({
    ...normalizeRow(r),
    user_name: userMap[r.user_id]?.full_name ?? '—',
  }));
}

async function getSosAlerts({ page, limit, status } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const params = [];
  let where = '';
  if (status) {
    where = 'WHERE s.status = ?';
    params.push(status);
  }

  const rows = await query(
    `SELECT s.id, s.user_id, s.triggered_at, s.resolved_at, s.status,
            p.full_name AS user_name,
            loc.latitude, loc.longitude, loc.address
     FROM sos_alerts s
     LEFT JOIN profiles p ON p.id = s.user_id
     LEFT JOIN elder_locations loc ON loc.elder_id = s.user_id
     ${where}
     ORDER BY s.triggered_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name || '—',
    triggered_at: toIso(r.triggered_at),
    resolved_at: r.resolved_at ? toIso(r.resolved_at) : null,
    status: r.status,
    location: r.latitude != null ? {
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      address: r.address || null,
    } : null,
  }));
}

async function getNotifications({ page, limit, type, search } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (type) {
    clauses.push('n.type = ?');
    params.push(type);
  }
  if (search) {
    clauses.push('(n.title LIKE ? OR n.body LIKE ? OR p.full_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT n.id, n.user_id, n.sender_id, n.type, n.title, n.body, n.data, n.\`read\`, n.created_at,
            p.full_name AS user_name
     FROM notifications n
     LEFT JOIN profiles p ON p.id = n.user_id
     ${where}
     ORDER BY n.created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_name: r.user_name || '—',
    sender_id: r.sender_id,
    type: r.type,
    title: r.title,
    body: r.body,
    data: typeof r.data === 'string' ? (() => { try { return JSON.parse(r.data); } catch { return r.data; } })() : r.data,
    read: !!r.read,
    created_at: toIso(r.created_at),
  }));
}

async function broadcastNotification(title, body) {
  const rows = await query('SELECT id FROM profiles WHERE is_banned = 0');
  const userIds = rows.map((r) => r.id);
  if (!userIds.length) return 0;

  const dataJson = JSON.stringify({ source: 'admin_broadcast' });

  for (let i = 0; i < userIds.length; i += 100) {
    const batch = userIds.slice(i, i + 100);
    const valuePlaceholders = batch.map(() => '(?, ?, NULL, ?, ?, ?, ?, 0)').join(', ');
    const params = [];
    batch.forEach((uid) => {
      params.push(randomUUID(), uid, 'announcement', title, body, dataJson);
    });

    await execute(
      `INSERT INTO notifications (id, user_id, sender_id, type, title, body, data, \`read\`)
       VALUES ${valuePlaceholders}`,
      params,
    );
  }

  return userIds.length;
}

async function getHealthRecords(params = {}) {
  const page = Math.max(1, parseInt(params.page) || 1);
  const limit = Math.max(1, parseInt(params.limit) || 10);
  const offset = (page - 1) * limit;

  let whereClauses = [];
  const queryParams = [];

  if (params.category && params.category !== 'All') {
    whereClauses.push('category = ?');
    queryParams.push(params.category);
  }
  if (params.user_id) {
    whereClauses.push('user_id = ?');
    queryParams.push(params.user_id);
  }
  if (params.search) {
    whereClauses.push('(title LIKE ? OR type LIKE ? OR category LIKE ?)');
    const q = `%${params.search}%`;
    queryParams.push(q, q, q);
  }

  const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT * FROM health_records ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    queryParams,
  );
  const [{ total }] = await query(
    `SELECT COUNT(*) AS total FROM health_records ${where}`,
    queryParams,
  );

  const userMap = await fetchUserMap([...new Set(rows.map((r) => r.user_id))]);
  return {
    records: rows.map((r) => ({
      ...normalizeRow(r),
      user_name: userMap[r.user_id]?.full_name ?? '—',
    })),
    total: Number(total) || 0,
    page,
    limit,
    pages: Math.ceil((Number(total) || 0) / limit),
  };
}

async function getEmergencyContacts({ page, limit, search } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(c.name LIKE ? OR c.phone LIKE ? OR p.full_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT c.id, c.user_id, c.name, c.role, c.phone, c.color, c.created_at,
            p.full_name AS user_name
     FROM emergency_contacts c
     LEFT JOIN profiles p ON p.id = c.user_id
     ${where}
     ORDER BY c.created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    ...normalizeRow(r),
    user_name: r.user_name || '—',
  }));
}

async function getJournalEntries({ page, limit, type, search } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (type) {
    clauses.push('j.type = ?');
    params.push(type);
  }
  if (search) {
    clauses.push('(j.content LIKE ? OR j.prompt LIKE ? OR p.full_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT j.id, j.user_id, j.type, j.content, j.audio_uri, j.prompt, j.created_at,
            p.full_name AS user_name
     FROM journal j
     LEFT JOIN profiles p ON p.id = j.user_id
     ${where}
     ORDER BY j.created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    ...normalizeRow(r),
    user_name: r.user_name || '—',
    content_preview: (r.content || '').slice(0, 160),
  }));
}

async function getFamilyMessages({ page, limit, search } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(m.message LIKE ? OR s.full_name LIKE ? OR r.full_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT m.id, m.sender_id, m.receiver_id, m.message, m.audio_url, m.created_at,
            s.full_name AS sender_name,
            r.full_name AS receiver_name
     FROM family_messages m
     LEFT JOIN profiles s ON s.id = m.sender_id
     LEFT JOIN profiles r ON r.id = m.receiver_id
     ${where}
     ORDER BY m.created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    ...normalizeRow(r),
    sender_name: r.sender_name || '—',
    receiver_name: r.receiver_name || '—',
    message_preview: (r.message || '').slice(0, 160),
  }));
}

async function getElderLocations({ page, limit, sharing } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (sharing === 'true' || sharing === '1') {
    clauses.push('l.is_sharing = 1');
  } else if (sharing === 'false' || sharing === '0') {
    clauses.push('l.is_sharing = 0');
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT l.elder_id, l.latitude, l.longitude, l.accuracy, l.address, l.is_sharing, l.updated_at,
            p.full_name AS user_name, p.location AS profile_location
     FROM elder_locations l
     LEFT JOIN profiles p ON p.id = l.elder_id
     ${where}
     ORDER BY l.updated_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    elder_id: r.elder_id,
    user_name: r.user_name || '—',
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    accuracy: r.accuracy == null ? null : Number(r.accuracy),
    address: r.address || r.profile_location || null,
    is_sharing: !!r.is_sharing,
    updated_at: toIso(r.updated_at),
  }));
}

async function getAppointments({ page, limit, status, search } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('a.status = ?');
    params.push(status);
  }
  if (search) {
    clauses.push('(a.doctor_name LIKE ? OR a.specialty LIKE ? OR p.full_name LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = await query(
    `SELECT a.id, a.user_id, a.doctor_name, a.specialty, a.date, a.time, a.fee, a.reason, a.status, a.created_at,
            p.full_name AS user_name
     FROM appointments a
     LEFT JOIN profiles p ON p.id = a.user_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    ...normalizeRow(r),
    user_name: r.user_name || '—',
  }));
}

async function getStreaks({ page, limit, search } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = ['p.deleted_at IS NULL', "p.role = 'elder'"];
  const params = [];
  if (search) {
    clauses.push('(p.full_name LIKE ? OR p.location LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const rows = await query(
    `SELECT p.id, p.full_name, p.location, p.streak, p.best_streak, p.last_active, p.created_at
     FROM profiles p
     ${where}
     ORDER BY p.streak DESC, p.best_streak DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.full_name || '—',
    location: r.location || '—',
    current_streak: Number(r.streak) || 0,
    longest_streak: Number(r.best_streak) || 0,
    last_activity: toIso(r.last_active),
    status: (Number(r.streak) || 0) > 0 ? 'active' : 'broken',
  }));
}

async function getUserSubscriptions({ page, limit, status, search } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = ['p.deleted_at IS NULL', "p.role = 'guardian'"];
  const params = [];
  if (status) {
    clauses.push('p.plan_status = ?');
    params.push(status);
  }
  if (search) {
    clauses.push('(p.full_name LIKE ? OR p.plan_type LIKE ? OR p.email LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q);
  }
  const where = `WHERE ${clauses.join(' AND ')}`;

  const rows = await query(
    `SELECT p.id, p.full_name, p.role, p.plan_type, p.plan_status, p.plan_amount, p.plan_currency,
            p.plan_interval, p.plan_elder_count, p.plan_started_at, p.plan_expires_at
     FROM profiles p
     ${where}
     ORDER BY p.plan_expires_at DESC, p.created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    user_name: r.full_name || '—',
    user_type: r.role === 'elder' ? 'Elder' : 'Guardian',
    plan: r.plan_type || 'free',
    status: r.plan_status || 'inactive',
    start_date: toIso(r.plan_started_at),
    renewal_date: toIso(r.plan_expires_at),
    amount: r.plan_amount == null ? 0 : Number(r.plan_amount),
    currency: r.plan_currency || 'INR',
    elder_count: r.plan_elder_count == null ? null : Number(r.plan_elder_count),
    interval: r.plan_interval,
  }));
}

async function getRevenueSummary() {
  const [captured] = await query(
    `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count
     FROM payments WHERE status = 'captured'`,
  );

  const monthly = await query(
    `SELECT DATE_FORMAT(COALESCE(captured_at, created_at), '%Y-%m') AS month,
            COALESCE(SUM(amount), 0) AS revenue,
            COUNT(*) AS payments
     FROM payments
     WHERE status = 'captured'
       AND COALESCE(captured_at, created_at) >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 6 MONTH)
     GROUP BY DATE_FORMAT(COALESCE(captured_at, created_at), '%Y-%m')
     ORDER BY month ASC`,
  );

  const byTier = await query(
    `SELECT o.elder_count_at_purchase AS elder_count,
            COALESCE(SUM(p.amount), 0) AS revenue,
            COUNT(DISTINCT o.guardian_id) AS subscribers
     FROM payment_orders o
     INNER JOIN payments p ON p.order_id = o.id AND p.status = 'captured'
     GROUP BY o.elder_count_at_purchase
     ORDER BY o.elder_count_at_purchase ASC`,
  );

  const [activeSubs] = await query(
    `SELECT COUNT(*) AS cnt FROM profiles
     WHERE deleted_at IS NULL AND role = 'guardian' AND plan_status = 'active'`,
  );

  return {
    total_revenue: Number(captured?.total) || 0,
    captured_payments: Number(captured?.count) || 0,
    active_subscriptions: Number(activeSubs?.cnt) || 0,
    monthly: monthly.map((m) => ({
      month: m.month,
      revenue: Number(m.revenue) || 0,
      payments: Number(m.payments) || 0,
    })),
    by_tier: byTier.map((t) => ({
      plan: `${t.elder_count} elder${Number(t.elder_count) === 1 ? '' : 's'}`,
      elder_count: Number(t.elder_count),
      revenue: Number(t.revenue) || 0,
      subscribers: Number(t.subscribers) || 0,
    })),
  };
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
  softDeleteProfile,
  restoreProfile,
  getDeletedProfile,
  getConnections,
  updateConnection,
  deleteConnection,
  getMedicines,
  getCheckIns,
  getMoods,
  getAIConversations,
  getCareEvents,
  getMindGames,
  getSosAlerts,
  getNotifications,
  broadcastNotification,
  getHealthRecords,
  getEmergencyContacts,
  getJournalEntries,
  getFamilyMessages,
  getElderLocations,
  getAppointments,
  getStreaks,
  getUserSubscriptions,
  getRevenueSummary,
};
