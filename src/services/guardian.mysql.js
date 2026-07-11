const { randomUUID } = require('crypto');
const { query, execute, withTransaction } = require('../config/mysql');
const journalService = require('./journal.service');
const mindGamesService = require('./mind-games.service');

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/** Monday..Sunday ISO dates (YYYY-MM-DD) for the calendar week containing `today` (UTC). */
function currentWeekDates(today) {
  const d = new Date(`${today}T00:00:00.000Z`);
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (isoDow - 1));
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + i);
    return day.toISOString().split('T')[0];
  });
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
    // plan_status starts 'inactive' — guardians must complete a payment before use
    // (CONTEXT.md Q6, no free trial); requireActivePlan middleware enforces this.
    await execute(
      `INSERT INTO profiles (
         id, email, full_name, role, plan_type, plan_status, plan_currency, streak
       ) VALUES (?, ?, ?, 'guardian', 'free', 'inactive', 'INR', 0)`,
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

/**
 * Guardian-created "shadow" elder profile (ADR 0004): creates a REAL, immediately-usable
 * app_users + profiles + guardian_elder_links(status='connected') row in one transaction —
 * not a pending invite. Caller (controller) is responsible for the phone/email uniqueness
 * pre-check and the mid-cycle tier-upgrade gate before calling this.
 *
 * No new auth-matching logic is needed elsewhere: findOrCreateByPhone/findOrCreateByGoogle
 * already check app_users.phone_e164/email first, so when the real elder later signs in with
 * the same phone (OTP) or email (Google), they land on exactly this profile.
 */
async function createElderProfile({
  guardianId,
  firstName,
  lastName,
  email,
  phoneE164,
  relation,
  age,
  bloodGroup,
  biologicalSex,
  preferredLanguage,
  medicalConditions,
  medicalNotes,
}) {
  const elderId = randomUUID();
  const fullName = `${firstName} ${lastName || ''}`.trim();

  await withTransaction(async (conn) => {
    await conn.execute(
      `INSERT INTO app_users (id, phone_e164, email, password_hash) VALUES (?, ?, ?, NULL)`,
      [elderId, phoneE164, email],
    );

    await conn.execute(
      `INSERT INTO profiles (
         id, first_name, last_name, full_name, email, mobile, role,
         age, blood_group, biological_sex, preferred_language, medical_conditions, other_condition,
         plan_type, plan_status, plan_currency, streak
       ) VALUES (?, ?, ?, ?, ?, ?, 'elder', ?, ?, ?, ?, ?, ?, 'free', 'active', 'INR', 0)`,
      [
        elderId,
        firstName,
        lastName || null,
        fullName,
        email,
        phoneE164,
        age ?? null,
        bloodGroup ?? null,
        biologicalSex ?? null,
        preferredLanguage ?? null,
        medicalConditions ? JSON.stringify(medicalConditions) : null,
        medicalNotes ?? null,
      ],
    );

    await conn.execute(
      `INSERT INTO guardian_elder_links (
         guardian_id, elder_id, elder_email, parent_name, relation, status
       ) VALUES (?, ?, ?, ?, ?, 'connected')`,
      [guardianId, elderId, email, fullName, relation],
    );
  });

  return {
    id: elderId,
    first_name: firstName,
    last_name: lastName || '',
    email,
    mobile: phoneE164,
    relation,
  };
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

/** `elderEmails` — every identifier this elder is known by (login email, profile email,
 *  phone-derived synthetic email) — see getPendingInvitations in guardian.controller.js. */
async function getPendingInvitations(elderEmails) {
  const emails = Array.isArray(elderEmails) ? elderEmails : [elderEmails];
  const { sql: inSql, params: inParams } = inClause(emails);

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
     WHERE l.elder_email IN (${inSql}) AND l.status = 'pending'
     ORDER BY l.created_at DESC`,
    inParams,
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
     WHERE guardian_id = ? AND status = 'connected'
       AND elder_id NOT IN (SELECT id FROM profiles WHERE deleted_at IS NOT NULL)`,
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
      `SELECT id, full_name, age, location, mobile, last_active
       FROM profiles
       WHERE id IN (${inSql})`,
      inParams,
    ),
    query(
      `SELECT user_id, mood
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
  const moodByUser = {};
  checkins.forEach((c) => { moodByUser[c.user_id] = c.mood ?? null; });
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
        ? { fullName: profile.full_name, age: profile.age, location: profile.location, mobile: profile.mobile }
        : null,
      checkedInToday: checkinIds.has(link.elder_id),
      medicineCount: userMeds.length,
      medicinesDone: userMeds.filter((id) => loggedMeds.has(id)).length,
      mood: moodByUser[link.elder_id] ?? null,
      lastActiveAt: profile?.last_active
        ? (profile.last_active instanceof Date ? profile.last_active.toISOString() : profile.last_active)
        : null,
    };
  });
}

async function getGuardianAlerts(guardianId) {
  const links = await query(
    `SELECT l.elder_id, l.parent_name, p.mobile AS elder_mobile
     FROM guardian_elder_links l
     LEFT JOIN profiles p ON p.id = l.elder_id
     WHERE l.guardian_id = ? AND l.status = 'connected'
       AND l.elder_id NOT IN (SELECT id FROM profiles WHERE deleted_at IS NOT NULL)`,
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
        elderId: eid,
        elderPhone: link.elder_mobile ?? null,
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
          elderId: eid,
          elderPhone: link.elder_mobile ?? null,
          tag: { text: 'Attention', bg: '#FFF3E0', fg: '#F59E0B' },
          who: name,
          title: `${missed.length} Medicine${missed.length > 1 ? 's' : ''} Not Taken`,
          body: `${names}${missed.length > 2 ? ` and ${missed.length - 2} more` : ''} not confirmed taken today.`,
          time: `Today · ${t}`,
        });
      } else {
        generated.push({
          id: `med_ok_${eid}`,
          elderId: eid,
          elderPhone: link.elder_mobile ?? null,
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
     WHERE guardian_id = ? AND status = 'connected'
       AND elder_id NOT IN (SELECT id FROM profiles WHERE deleted_at IS NOT NULL)`,
    [guardianId],
  );

  const ids = links.map((l) => l.elder_id).filter(Boolean);
  const pMap = {};
  const locMap = {};

  if (ids.length > 0) {
    const { sql: inSql, params: inParams } = inClause(ids);
    const [profiles, locations] = await Promise.all([
      query(`SELECT id, full_name FROM profiles WHERE id IN (${inSql})`, inParams),
      query(
        `SELECT elder_id, latitude, longitude, accuracy, address, is_sharing, updated_at
         FROM elder_locations
         WHERE elder_id IN (${inSql})`,
        inParams,
      ),
    ]);
    profiles.forEach((p) => { pMap[p.id] = p; });
    locations.forEach((l) => { locMap[l.elder_id] = l; });
  }

  return links.map((link) => {
    const loc = locMap[link.elder_id];
    const isSharing = !!loc?.is_sharing;
    return {
      elderId:    link.elder_id,
      name:       pMap[link.elder_id]?.full_name || link.parent_name,
      relation:   link.relation,
      isSharing,
      latitude:   isSharing ? loc.latitude : null,
      longitude:  isSharing ? loc.longitude : null,
      accuracy:   isSharing ? loc.accuracy : null,
      address:    isSharing ? loc.address : null,
      updatedAt:  isSharing && loc.updated_at
        ? (loc.updated_at instanceof Date ? loc.updated_at.toISOString() : loc.updated_at)
        : null,
    };
  });
}

const PERIOD_DAYS = { weekly: 7, monthly: 30, yearly: 365 };

function isoDateOnly(d) {
  return d.toISOString().split('T')[0];
}

/** Groups `windowDays` days ending today into `bucketCount` roughly-equal buckets,
 *  returning [{ startIso, endIso }] oldest-first — used to build the bar chart at
 *  weekly (7 daily bars), monthly (~4 weekly bars), or yearly (12 monthly bars)
 *  granularity from the same underlying per-day data. */
function buildBuckets(windowDays, bucketCount) {
  const today = new Date();
  const buckets = [];
  const daysPerBucket = windowDays / bucketCount;
  for (let i = 0; i < bucketCount; i++) {
    const endOffset = Math.round(windowDays - i * daysPerBucket) - 1;
    const startOffset = Math.round(windowDays - (i + 1) * daysPerBucket);
    const start = new Date(today); start.setDate(start.getDate() - Math.max(startOffset, 0));
    const end = new Date(today); end.setDate(end.getDate() - endOffset);
    buckets.push({ startIso: isoDateOnly(start), endIso: isoDateOnly(end) });
  }
  return buckets;
}

async function getGuardianReports(guardianId, period = 'weekly') {
  const emptyMetrics = {
    medAdherence: '--',
    medTrend: '--',
    avgMood: '--',
    moodTrend: '--',
    checkinStreak: '--',
    avgSleep: '--',
  };
  const bucketCount = period === 'weekly' ? 7 : period === 'monthly' ? 4 : 12;
  const emptyBars = Array.from({ length: bucketCount }, () => 0);

  const links = await query(
    `SELECT elder_id, parent_name
     FROM guardian_elder_links
     WHERE guardian_id = ? AND status = 'connected'
       AND elder_id NOT IN (SELECT id FROM profiles WHERE deleted_at IS NOT NULL)
     LIMIT 1`,
    [guardianId],
  );

  if (!links[0]) {
    return { elderName: 'Elder', bars: emptyBars, metrics: emptyMetrics };
  }

  const elderId = links[0].elder_id;
  const elderName = links[0].parent_name.split(' ')[0].toUpperCase();

  const windowDays = PERIOD_DAYS[period] ?? PERIOD_DAYS.weekly;
  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - (windowDays - 1));
  const windowStartIso = isoDateOnly(windowStart);
  const windowStartTs = `${windowStartIso} 00:00:00.000`;

  // Streak is always "consecutive days ending today", independent of the selected period.
  const streakWindowStart = new Date();
  streakWindowStart.setDate(streakWindowStart.getDate() - 29);
  const streakWindowStartIso = isoDateOnly(streakWindowStart);

  const [moods, activeMedRows, logRows, sleepRows, streakCheckinRows] = await Promise.all([
    query(
      `SELECT created_at, mood_score
       FROM mood_entries
       WHERE user_id = ? AND created_at >= ?`,
      [elderId, windowStartTs],
    ),
    query(
      `SELECT id FROM medicines
       WHERE user_id = ? AND is_active = 1`,
      [elderId],
    ),
    query(
      `SELECT medicine_id FROM medicine_logs
       WHERE user_id = ? AND taken_at >= ?`,
      [elderId, windowStartTs],
    ),
    query(
      `SELECT sleep_hours
       FROM daily_checkins
       WHERE user_id = ? AND check_in_date >= ? AND sleep_hours IS NOT NULL`,
      [elderId, windowStartIso],
    ),
    query(
      `SELECT check_in_date FROM daily_checkins
       WHERE user_id = ? AND check_in_date >= ?`,
      [elderId, streakWindowStartIso],
    ),
  ]);

  const moodByDate = {};
  moods.forEach((m) => {
    const dateKey = m.created_at instanceof Date
      ? m.created_at.toISOString().slice(0, 10)
      : String(m.created_at).slice(0, 10);
    if (!moodByDate[dateKey]) moodByDate[dateKey] = [];
    moodByDate[dateKey].push(m.mood_score);
  });

  const buckets = buildBuckets(windowDays, bucketCount);
  const bars = buckets.map(({ startIso, endIso }) => {
    const scores = [];
    Object.keys(moodByDate).forEach((dateKey) => {
      if (dateKey >= startIso && dateKey <= endIso) scores.push(...moodByDate[dateKey]);
    });
    if (scores.length === 0) return 0;
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    return Math.round(avg * 20);
  });

  const activeMeds = activeMedRows.length;
  const logCount = logRows.length;
  const maxPossible = activeMeds * windowDays;
  const adherence = maxPossible > 0 ? Math.round((logCount / maxPossible) * 100) : null;

  const avgMoodScore = moods.length > 0
    ? (moods.reduce((s, m) => s + m.mood_score, 0) / moods.length).toFixed(1)
    : null;

  const streakCheckinDates = new Set(
    streakCheckinRows.map((c) => (
      c.check_in_date instanceof Date
        ? c.check_in_date.toISOString().slice(0, 10)
        : String(c.check_in_date).slice(0, 10)
    )),
  );
  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    if (streakCheckinDates.has(isoDateOnly(d))) streak++;
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
     WHERE elder_id = ? AND status = 'connected'
       AND guardian_id NOT IN (SELECT id FROM profiles WHERE deleted_at IS NOT NULL)`,
    [elderId],
  );

  if (links.length === 0) return [];

  const guardianIds = links.map((l) => l.guardian_id).filter(Boolean);
  const { sql: inSql, params: inParams } = inClause(guardianIds);

  const profiles = guardianIds.length > 0
    ? await query(
      `SELECT id, full_name, location, mobile, push_token
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
    push_token: profileMap[link.guardian_id]?.push_token ?? null,
  }));
}

async function isConnectedToElder(guardianId, elderId) {
  const rows = await query(
    `SELECT id FROM guardian_elder_links
     WHERE guardian_id = ? AND elder_id = ? AND status = 'connected'
     LIMIT 1`,
    [guardianId, elderId],
  );
  return rows.length > 0;
}

async function unlinkElder(guardianId, elderId) {
  const result = await execute(
    `DELETE FROM guardian_elder_links
     WHERE guardian_id = ? AND elder_id = ? AND status = 'connected'`,
    [guardianId, elderId],
  );
  return result.affectedRows > 0;
}

async function getElderPushToken(elderId) {
  const rows = await query('SELECT push_token FROM profiles WHERE id = ? LIMIT 1', [elderId]);
  return rows[0]?.push_token ?? null;
}

function isoDate(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

async function getElderSummaryForGuardian(guardianId, elderId) {
  const connected = await isConnectedToElder(guardianId, elderId);
  if (!connected) {
    const error = new Error('You are not connected to this elder.');
    error.statusCode = 403;
    throw error;
  }

  const [profileRows, checkins, moods] = await Promise.all([
    query('SELECT id, full_name, age, location FROM profiles WHERE id = ? LIMIT 1', [elderId]),
    query(
      `SELECT check_in_date, mood, mood_score, sleep_hours, sleep_quality, energy_level,
              pain_level, physical_activity, notes
       FROM daily_checkins
       WHERE user_id = ?
       ORDER BY check_in_date DESC
       LIMIT 14`,
      [elderId],
    ),
    query(
      `SELECT mood, mood_score, note, created_at
       FROM mood_entries
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 14`,
      [elderId],
    ),
  ]);

  const profile = profileRows[0] ?? null;

  return {
    elderId,
    profile: profile
      ? { fullName: profile.full_name, age: profile.age, location: profile.location }
      : null,
    checkins: checkins.map((c) => ({
      date:             isoDate(c.check_in_date),
      mood:             c.mood,
      moodScore:        c.mood_score,
      sleepHours:       c.sleep_hours != null ? Number(c.sleep_hours) : null,
      sleepQuality:     c.sleep_quality,
      energyLevel:      c.energy_level,
      painLevel:        c.pain_level,
      physicalActivity: c.physical_activity,
      notes:            c.notes,
    })),
    moods: moods.map((m) => ({
      mood:      m.mood,
      moodScore: m.mood_score,
      note:      m.note,
      createdAt: isoDate(m.created_at),
    })),
  };
}

/** Builds the merged, real-data "Today's Activity" feed for the guardian home dashboard —
 *  no fabricated entries; anything with no rows today just contributes nothing. */
function buildActivityFeed({ journalEntries, moods, checkin, medLogs, medNameById, today }) {
  const items = [];

  journalEntries
    .filter((j) => (j.created_at ?? '').slice(0, 10) === today)
    .forEach((j) => {
      items.push({
        type:      'journal',
        title:     j.type === 'Voice' ? 'Recorded a memory in journal' : 'Wrote a journal entry',
        subtitle:  j.content ? String(j.content).slice(0, 120) : (j.prompt ?? ''),
        timestamp: j.created_at,
      });
    });

  moods
    .filter((m) => (m.created_at ?? '').slice(0, 10) === today)
    .forEach((m) => {
      items.push({
        type:      'mood',
        title:     `Logged mood: ${m.mood ?? '—'}`,
        subtitle:  m.note ?? '',
        timestamp: m.created_at,
      });
    });

  if (checkin) {
    items.push({
      type:      'checkin',
      title:     'Completed daily check-in',
      subtitle:  [checkin.mood, checkin.sleep_hours != null ? `${checkin.sleep_hours}h sleep` : null]
        .filter(Boolean).join(' · '),
      timestamp: checkin.created_at,
    });
  }

  medLogs.forEach((log) => {
    items.push({
      type:      'medicine',
      title:     'Confirmed medicine taken',
      subtitle:  medNameById[log.medicine_id] ?? '',
      timestamp: log.taken_at,
    });
  });

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);
}

async function getElderDashboardForGuardian(guardianId, elderId) {
  const connected = await isConnectedToElder(guardianId, elderId);
  if (!connected) {
    const error = new Error('You are not connected to this elder.');
    error.statusCode = 403;
    throw error;
  }

  const today = todayISO();
  const weekDates = currentWeekDates(today);

  const [
    profileRows, medicines, medLogsToday, checkinToday, moods, journalEntries,
    memoriesCount, mindStats, weekCheckins, locationRows,
  ] = await Promise.all([
    query('SELECT id, full_name, age, location, profile_image, mobile, streak, last_active FROM profiles WHERE id = ? LIMIT 1', [elderId]),
    query('SELECT id, name, dosage, time, schedule_time, instruction, priority FROM medicines WHERE user_id = ? AND is_active = 1', [elderId]),
    query('SELECT medicine_id, taken_at FROM medicine_logs WHERE user_id = ? AND taken_date = ?', [elderId, today]),
    query(
      `SELECT mood, sleep_hours, created_at FROM daily_checkins WHERE user_id = ? AND check_in_date = ? LIMIT 1`,
      [elderId, today],
    ),
    query('SELECT mood, note, created_at FROM mood_entries WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 10', [elderId, `${today} 00:00:00.000`]),
    journalService.listByUser(elderId),
    journalService.countByUser(elderId),
    mindGamesService.getUserStats(elderId),
    query(
      `SELECT check_in_date FROM daily_checkins WHERE user_id = ? AND check_in_date BETWEEN ? AND ?`,
      [elderId, weekDates[0], weekDates[6]],
    ),
    query(
      `SELECT latitude, longitude, accuracy, address, is_sharing, updated_at
       FROM elder_locations WHERE elder_id = ? LIMIT 1`,
      [elderId],
    ),
  ]);

  const profile = profileRows[0] ?? null;
  const loggedMedIds = new Set(medLogsToday.map((l) => l.medicine_id));
  const medNameById = {};
  medicines.forEach((m) => { medNameById[m.id] = m.name; });

  const checkedInDates = new Set(
    weekCheckins.map((c) => (c.check_in_date instanceof Date
      ? c.check_in_date.toISOString().split('T')[0]
      : String(c.check_in_date))),
  );
  const checkinWeek = weekDates.map((date) => {
    let status;
    if (date > today) status = 'future';
    else if (date === today) status = checkedInDates.has(date) ? 'done' : 'pending';
    else status = checkedInDates.has(date) ? 'done' : 'missed';
    return { date, status };
  });

  const loc = locationRows[0] ?? null;
  const isSharing = !!loc?.is_sharing;
  const location = loc ? {
    isSharing,
    latitude:  isSharing ? loc.latitude : null,
    longitude: isSharing ? loc.longitude : null,
    accuracy:  isSharing ? loc.accuracy : null,
    address:   isSharing ? loc.address : null,
    updatedAt: isSharing && loc.updated_at
      ? (loc.updated_at instanceof Date ? loc.updated_at.toISOString() : loc.updated_at)
      : null,
  } : null;

  const activity = buildActivityFeed({
    journalEntries: journalEntries.slice(0, 10),
    moods,
    checkin: checkinToday[0] ?? null,
    medLogs: medLogsToday,
    medNameById,
    today,
  });

  const activeMedCount = medicines.length;
  const takenMedCount = medicines.filter((m) => loggedMedIds.has(m.id)).length;
  const adherencePercent = activeMedCount > 0 ? Math.round((takenMedCount / activeMedCount) * 100) : null;

  return {
    elderId,
    profile: profile ? {
      fullName:     profile.full_name,
      age:          profile.age,
      location:     profile.location,
      profileImage: profile.profile_image,
      mobile:       profile.mobile,
      streak:       profile.streak ?? 0,
    } : null,
    medicines: medicines.map((m) => ({
      id:           m.id,
      name:         m.name,
      dosage:       m.dosage,
      time:         m.time,
      scheduleTime: m.schedule_time,
      instruction:  m.instruction,
      priority:     m.priority,
      takenToday:   loggedMedIds.has(m.id),
    })),
    adherencePercent,
    memoriesCount,
    mindGamesScore: mindStats.totalScore ?? 0,
    checkedInToday: !!checkinToday[0],
    mood: checkinToday[0]?.mood ?? null,
    lastActiveAt: profile?.last_active
      ? (profile.last_active instanceof Date ? profile.last_active.toISOString() : profile.last_active)
      : null,
    checkinWeek,
    location,
    activity,
  };
}

/** Normalizes a MySQL DATE/DATETIME value (Date object or string) to 'YYYY-MM-DD'. */
function toDateOnlyString(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().split('T')[0] : String(value).slice(0, 10);
}

/**
 * Per-day medicine-adherence bucket for the "7-Day Adherence" strip on the guardian
 * elder-medicines screen — Monday..Sunday of the current calendar week (UTC), mirroring
 * `checkinWeek`'s date-range convention above. For each day, "expected" doses are the
 * elder's active medicines whose `days_of_week` includes that weekday and whose
 * start/end date window covers the day; "taken" is how many of those were logged.
 * `status` buckets the taken/expected ratio into good (>=80%) / ok (50-79%) / poor (<50%),
 * plus `none` (nothing scheduled that day) and `future` (day hasn't happened yet).
 */
async function getElderMedicineAdherenceWeek(guardianId, elderId) {
  const connected = await isConnectedToElder(guardianId, elderId);
  if (!connected) {
    const error = new Error('You are not connected to this elder.');
    error.statusCode = 403;
    throw error;
  }

  const today = todayISO();
  const weekDates = currentWeekDates(today);

  const [medicineRows, logRows] = await Promise.all([
    query(
      `SELECT id, days_of_week, start_date, end_date
       FROM medicines WHERE user_id = ? AND is_active = 1`,
      [elderId],
    ),
    query(
      `SELECT medicine_id, DATE(taken_at) AS taken_date
       FROM medicine_logs
       WHERE user_id = ? AND taken_at >= ? AND taken_at <= ?`,
      [elderId, `${weekDates[0]} 00:00:00.000`, `${weekDates[6]} 23:59:59.999`],
    ),
  ]);

  const medicines = medicineRows.map((m) => {
    let days = m.days_of_week;
    if (typeof days === 'string') {
      try { days = JSON.parse(days); } catch { days = []; }
    }
    return {
      id:    m.id,
      days:  Array.isArray(days) ? days : [],
      start: toDateOnlyString(m.start_date),
      end:   toDateOnlyString(m.end_date),
    };
  });

  const takenByDate = new Map();
  for (const row of logRows) {
    const date = toDateOnlyString(row.taken_date);
    if (!takenByDate.has(date)) takenByDate.set(date, new Set());
    takenByDate.get(date).add(row.medicine_id);
  }

  return weekDates.map((date) => {
    if (date > today) {
      return { date, status: 'future', percent: null };
    }

    const dow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const expected = medicines.filter((m) => {
      if (!m.days.includes(dow)) return false;
      if (m.start && date < m.start) return false;
      if (m.end && date > m.end) return false;
      return true;
    });

    if (expected.length === 0) {
      return { date, status: 'none', percent: null };
    }

    const takenIds = takenByDate.get(date) ?? new Set();
    const takenCount = expected.filter((m) => takenIds.has(m.id)).length;
    const percent = Math.round((takenCount / expected.length) * 100);
    const status = percent >= 80 ? 'good' : percent >= 50 ? 'ok' : 'poor';
    return { date, status, percent };
  });
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
  createElderProfile,
  respondToInvitation,
  getPendingInvitations,
  savePushToken,
  getGuardianEldersDashboard,
  getGuardianAlerts,
  getGuardianLocationElders,
  getGuardianReports,
  getConnectedGuardians,
  listSentInvitations,
  isConnectedToElder,
  unlinkElder,
  getElderPushToken,
  getElderSummaryForGuardian,
  getElderDashboardForGuardian,
  getElderMedicineAdherenceWeek,
};
