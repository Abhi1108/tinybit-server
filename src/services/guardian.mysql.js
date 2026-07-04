const { query, execute } = require('../config/mysql');

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function inClause(ids) {
  if (!ids.length) return { sql: 'NULL', params: [] };
  return { sql: ids.map(() => '?').join(', '), params: ids };
}

function isDuplicateKeyError(err) {
  return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
}

function isForeignKeyError(err) {
  return err?.code === 'ER_NO_REFERENCED_ROW_2' || err?.errno === 1452;
}

async function ensureGuardianProfile(guardianId, guardianName, email) {
  const existing = await query('SELECT id FROM profiles WHERE id = ? LIMIT 1', [guardianId]);
  if (existing[0]?.id) return;

  try {
    await execute(
      `INSERT INTO profiles (
         id, email, full_name, role, plan_type, plan_status, plan_currency, streak
       ) VALUES (?, ?, ?, 'guardian', 'free', 'active', 'INR', 0)`,
      [guardianId, email ?? null, guardianName || email || 'Family member'],
    );
  } catch (err) {
    const message = isForeignKeyError(err)
      ? 'Complete your profile before inviting an elder.'
      : (err.message || 'Complete your profile before inviting an elder.');
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
}

async function findProfileByEmail(elderEmail) {
  const rows = await query(
    'SELECT id, push_token FROM profiles WHERE email = ? LIMIT 1',
    [elderEmail],
  );
  return rows[0] ?? null;
}

async function hasPendingInvite(guardianId, elderEmail) {
  const rows = await query(
    `SELECT id FROM guardian_elder_links
     WHERE guardian_id = ? AND elder_email = ? AND status = 'pending'
     LIMIT 1`,
    [guardianId, elderEmail],
  );
  return rows.length > 0;
}

async function createInvitation({ guardian_id, elder_id, elder_email, parent_name, relation }) {
  try {
    await execute(
      `INSERT INTO guardian_elder_links (
         guardian_id, elder_id, elder_email, parent_name, relation, status
       ) VALUES (?, ?, ?, ?, ?, 'pending')`,
      [guardian_id, elder_id, elder_email, parent_name, relation],
    );
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new Error('A pending invitation already exists for this email');
    }
    throw new Error(err.message || 'Failed to create invitation');
  }
}

async function respondToInvitation(linkId, action, elderId) {
  const newStatus = action === 'accept' ? 'connected' : 'declined';

  const result = await execute(
    `UPDATE guardian_elder_links
     SET status = ?, elder_id = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ?`,
    [newStatus, elderId, linkId],
  );

  if (result.affectedRows === 0) {
    throw new Error('Failed to update invitation');
  }

  return newStatus;
}

async function getPendingInvitations(elderEmail) {
  return query(
    `SELECT
       l.id,
       l.guardian_id,
       l.parent_name,
       l.relation,
       l.created_at,
       COALESCE(p.full_name, 'Unknown') AS guardian_name
     FROM guardian_elder_links l
     LEFT JOIN profiles p ON p.id = l.guardian_id
     WHERE l.elder_email = ? AND l.status = 'pending'
     ORDER BY l.created_at DESC`,
    [elderEmail],
  );
}

async function savePushToken(userId, pushToken) {
  const result = await execute(
    'UPDATE profiles SET push_token = ? WHERE id = ?',
    [pushToken, userId],
  );

  if (result.affectedRows === 0) {
    throw new Error('Profile not found');
  }
}

async function getConnectedLinksForGuardian(guardianId) {
  return query(
    `SELECT elder_id, parent_name, relation, elder_email
     FROM guardian_elder_links
     WHERE guardian_id = ? AND status = 'connected'`,
    [guardianId],
  );
}

async function getGuardianEldersDashboard(guardianId) {
  const links = await getConnectedLinksForGuardian(guardianId);
  if (links.length === 0) return [];

  const elderIds = links.map((l) => l.elder_id).filter(Boolean);
  if (elderIds.length === 0) {
    return links.map((link) => ({
      elderId: link.elder_id,
      parentName: link.parent_name,
      relation: link.relation,
      elderEmail: link.elder_email,
      profile: null,
      checkedInToday: false,
      medicineCount: 0,
      medicinesDone: 0,
    }));
  }

  const today = todayISO();
  const { sql: inSql, params: inParams } = inClause(elderIds);

  const [profiles, checkins, meds, logs] = await Promise.all([
    query(
      `SELECT id, full_name, age, location
       FROM profiles
       WHERE id IN (${inSql})`,
      inParams,
    ),
    query(
      `SELECT user_id
       FROM daily_checkins
       WHERE user_id IN (${inSql}) AND check_in_date = ?`,
      [...inParams, today],
    ),
    query(
      `SELECT id, user_id
       FROM medicines
       WHERE is_active = 1 AND user_id IN (${inSql})`,
      inParams,
    ),
    query(
      `SELECT medicine_id, user_id
       FROM medicine_logs
       WHERE user_id IN (${inSql}) AND taken_date = ?`,
      [...inParams, today],
    ),
  ]);

  const pMap = {};
  profiles.forEach((p) => { pMap[p.id] = p; });

  const checkinIds = new Set(checkins.map((c) => c.user_id));
  const medsByUser = {};
  meds.forEach((m) => {
    if (!medsByUser[m.user_id]) medsByUser[m.user_id] = [];
    medsByUser[m.user_id].push(m.id);
  });
  const loggedMeds = new Set(logs.map((l) => l.medicine_id));

  return links.map((link) => {
    const profile = pMap[link.elder_id] || null;
    const userMeds = medsByUser[link.elder_id] || [];
    return {
      elderId: link.elder_id,
      parentName: link.parent_name,
      relation: link.relation,
      elderEmail: link.elder_email,
      profile: profile
        ? { fullName: profile.full_name, age: profile.age, location: profile.location }
        : null,
      checkedInToday: checkinIds.has(link.elder_id),
      medicineCount: userMeds.length,
      medicinesDone: userMeds.filter((id) => loggedMeds.has(id)).length,
    };
  });
}

async function getGuardianAlerts(guardianId) {
  const links = await query(
    `SELECT elder_id, parent_name
     FROM guardian_elder_links
     WHERE guardian_id = ? AND status = 'connected'`,
    [guardianId],
  );

  if (links.length === 0) return [];

  const today = todayISO();
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const hour = new Date().getHours();
  const generated = [];

  for (const link of links) {
    const name = link.parent_name.toUpperCase();
    const eid = link.elder_id;

    const [checkinRows, medRows] = await Promise.all([
      query(
        `SELECT id FROM daily_checkins
         WHERE user_id = ? AND check_in_date = ?
         LIMIT 1`,
        [eid, today],
      ),
      query(
        `SELECT id, name FROM medicines
         WHERE user_id = ? AND is_active = 1`,
        [eid],
      ),
    ]);

    if (!checkinRows[0] && hour >= 9) {
      generated.push({
        id: `checkin_${eid}`,
        tag: { text: 'Urgent', bg: '#FCEEEF', fg: '#DC2626' },
        who: name,
        title: 'Morning Check-In Not Completed',
        body: `${link.parent_name} has not completed today's check-in. Please check on them.`,
        time: `Today · ${t}`,
      });
    }

    if (medRows.length > 0) {
      const logRows = await query(
        `SELECT medicine_id FROM medicine_logs
         WHERE user_id = ? AND taken_date = ?`,
        [eid, today],
      );

      const loggedIds = new Set(logRows.map((l) => l.medicine_id));
      const missed = medRows.filter((m) => !loggedIds.has(m.id));

      if (missed.length > 0) {
        const names = missed.slice(0, 2).map((m) => m.name).join(', ');
        generated.push({
          id: `med_${eid}`,
          tag: { text: 'Attention', bg: '#FFF3E0', fg: '#F59E0B' },
          who: name,
          title: `${missed.length} Medicine${missed.length > 1 ? 's' : ''} Not Taken`,
          body: `${names}${missed.length > 2 ? ` and ${missed.length - 2} more` : ''} not confirmed taken today.`,
          time: `Today · ${t}`,
        });
      } else {
        generated.push({
          id: `med_ok_${eid}`,
          tag: { text: 'Good Going', bg: '#D1FADF', fg: '#16A34A' },
          who: name,
          title: 'All Medicines Taken Today',
          body: `${link.parent_name} has confirmed all ${medRows.length} medicine${medRows.length > 1 ? 's' : ''} today.`,
          time: `Today · ${t}`,
        });
      }
    }
  }

  if (generated.length === 0) {
    generated.push({
      id: 'all_ok',
      tag: { text: 'Good Going', bg: '#D1FADF', fg: '#16A34A' },
      who: 'ALL',
      title: 'Everything looks good!',
      body: 'No urgent alerts right now. All family members are on track.',
      time: `Today · ${t}`,
    });
  }

  return generated;
}

async function getGuardianLocationElders(guardianId) {
  const links = await query(
    `SELECT elder_id, parent_name, relation
     FROM guardian_elder_links
     WHERE guardian_id = ? AND status = 'connected'`,
    [guardianId],
  );

  const ids = links.map((l) => l.elder_id).filter(Boolean);
  const pMap = {};

  if (ids.length > 0) {
    const { sql: inSql, params: inParams } = inClause(ids);
    const profiles = await query(
      `SELECT id, full_name, location
       FROM profiles
       WHERE id IN (${inSql})`,
      inParams,
    );
    profiles.forEach((p) => { pMap[p.id] = p; });
  }

  return links.map((link) => ({
    elderId: link.elder_id,
    name: pMap[link.elder_id]?.full_name || link.parent_name,
    relation: link.relation,
    location: pMap[link.elder_id]?.location || null,
  }));
}

async function getGuardianReports(guardianId) {
  const emptyMetrics = {
    medAdherence: '--',
    medTrend: '--',
    avgMood: '--',
    moodTrend: '--',
    checkinStreak: '--',
    avgSleep: '--',
  };

  const links = await query(
    `SELECT elder_id, parent_name
     FROM guardian_elder_links
     WHERE guardian_id = ? AND status = 'connected'
     LIMIT 1`,
    [guardianId],
  );

  if (!links[0]) {
    return { elderName: 'Elder', bars: [0, 0, 0, 0, 0, 0, 0], metrics: emptyMetrics };
  }

  const elderId = links[0].elder_id;
  const elderName = links[0].parent_name.split(' ')[0].toUpperCase();

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
  const weekStart = dates[0];
  const weekStartTs = `${weekStart} 00:00:00.000`;

  const [moods, activeMedRows, logRows, checkinRows, sleepRows] = await Promise.all([
    query(
      `SELECT created_at, mood_score
       FROM mood_entries
       WHERE user_id = ? AND created_at >= ?`,
      [elderId, weekStartTs],
    ),
    query(
      `SELECT id FROM medicines
       WHERE user_id = ? AND is_active = 1`,
      [elderId],
    ),
    query(
      `SELECT medicine_id FROM medicine_logs
       WHERE user_id = ? AND taken_at >= ?`,
      [elderId, weekStartTs],
    ),
    query(
      `SELECT check_in_date, created_at
       FROM daily_checkins
       WHERE user_id = ? AND check_in_date >= ?`,
      [elderId, weekStart],
    ),
    query(
      `SELECT sleep_hours
       FROM daily_checkins
       WHERE user_id = ? AND check_in_date >= ? AND sleep_hours IS NOT NULL`,
      [elderId, weekStart],
    ),
  ]);

  const moodMap = {};
  moods.forEach((m) => {
    const dateKey = m.created_at instanceof Date
      ? m.created_at.toISOString().slice(0, 10)
      : String(m.created_at).slice(0, 10);
    moodMap[dateKey] = m.mood_score;
  });
  const bars = dates.map((d) => (moodMap[d] ? moodMap[d] * 20 : 0));

  const activeMeds = activeMedRows.length;
  const logCount = logRows.length;
  const maxPossible = activeMeds * 7;
  const adherence = maxPossible > 0 ? Math.round((logCount / maxPossible) * 100) : null;

  const avgMoodScore = moods.length > 0
    ? (moods.reduce((s, m) => s + m.mood_score, 0) / moods.length).toFixed(1)
    : null;

  const checkinDates = new Set(
    checkinRows.map((c) => (
      c.check_in_date instanceof Date
        ? c.check_in_date.toISOString().slice(0, 10)
        : String(c.check_in_date).slice(0, 10)
    )),
  );
  let streak = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (checkinDates.has(dates[i])) streak++;
    else break;
  }

  const avgSleep = sleepRows.length > 0
    ? (sleepRows.reduce((s, r) => s + Number(r.sleep_hours), 0) / sleepRows.length).toFixed(1)
    : null;

  return {
    elderName,
    bars,
    metrics: {
      medAdherence: adherence != null ? `${adherence}%` : '--',
      medTrend: adherence != null ? (adherence >= 80 ? '+Good' : 'Low') : '--',
      avgMood: avgMoodScore ? `${avgMoodScore}/5` : '--',
      moodTrend: avgMoodScore ? (Number(avgMoodScore) >= 3.5 ? 'Good' : 'Low') : '--',
      checkinStreak: `${streak}d`,
      avgSleep: avgSleep ? `${avgSleep}h` : '--',
    },
  };
}

async function getConnectedGuardians(elderId) {
  const links = await query(
    `SELECT guardian_id, relation
     FROM guardian_elder_links
     WHERE elder_id = ? AND status = 'connected'`,
    [elderId],
  );

  if (links.length === 0) return [];

  const guardianIds = links.map((l) => l.guardian_id).filter(Boolean);
  const { sql: inSql, params: inParams } = inClause(guardianIds);

  const profiles = guardianIds.length > 0
    ? await query(
      `SELECT id, full_name, location, mobile
       FROM profiles
       WHERE id IN (${inSql})`,
      inParams,
    )
    : [];

  const profileMap = {};
  profiles.forEach((p) => { profileMap[p.id] = p; });

  return links.map((link) => ({
    id: link.guardian_id,
    name: profileMap[link.guardian_id]?.full_name ?? 'Guardian',
    relation: link.relation,
    location: profileMap[link.guardian_id]?.location ?? null,
    phone: profileMap[link.guardian_id]?.mobile ?? null,
  }));
}

async function listSentInvitations(guardianId) {
  const rows = await query(
    `SELECT id, guardian_id, elder_id, elder_email, parent_name, relation, status, created_at, updated_at
     FROM guardian_elder_links
     WHERE guardian_id = ?
     ORDER BY created_at DESC`,
    [guardianId],
  );
  return rows.map((row) => ({
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }));
}

module.exports = {
  ensureGuardianProfile,
  findProfileByEmail,
  hasPendingInvite,
  createInvitation,
  respondToInvitation,
  getPendingInvitations,
  savePushToken,
  getGuardianEldersDashboard,
  getGuardianAlerts,
  getGuardianLocationElders,
  getGuardianReports,
  getConnectedGuardians,
  listSentInvitations,
};
