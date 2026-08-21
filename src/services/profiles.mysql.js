const { query, execute } = require('../config/mysql');
const { notifyGuardiansOfElder } = require('./notifications.service');
const { todayForTimezone, dateOnlyForTimezone, addDays, DEFAULT_TIMEZONE } = require('../utils/date');
const { getUserTimezone } = require('./timezone.service');

/** Normalizes a MySQL DATE/DATETIME value (Date object or string) to 'YYYY-MM-DD'. */
function columnDateOnly(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

const PROFILE_JSON_COLUMNS = new Set(['medical_conditions', 'allergies']);

function serializeProfileValue(key, value) {
  if (value === undefined) return undefined;
  if (PROFILE_JSON_COLUMNS.has(key) && value !== null && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return value;
}

function parseProfileRow(row) {
  if (!row) return null;

  const parsed = { ...row };
  for (const key of PROFILE_JSON_COLUMNS) {
    if (parsed[key] == null) continue;
    if (typeof parsed[key] === 'string') {
      try {
        parsed[key] = JSON.parse(parsed[key]);
      } catch {
        // leave as-is
      }
    }
  }
  return parsed;
}

function buildUpsertSql(row) {
  const { id, ...fields } = row;
  const entries = Object.entries(fields).filter(([, value]) => value !== undefined);

  if (!id) {
    throw new Error('Profile id is required');
  }

  const columns = ['id', ...entries.map(([key]) => key)];
  const values = [id, ...entries.map(([key, value]) => serializeProfileValue(key, value))];
  const placeholders = columns.map(() => '?').join(', ');

  const updates = entries
    .map(([key]) => `${key} = VALUES(${key})`)
    .join(', ');

  const sql = updates.length > 0
    ? `INSERT INTO profiles (${columns.join(', ')})
       VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${updates}`
    : `INSERT INTO profiles (id) VALUES (?)
       ON DUPLICATE KEY UPDATE id = id`;

  return { sql, values };
}

async function upsertProfile(row) {
  const { sql, values } = buildUpsertSql(row);
  await execute(sql, values);

  return getProfileById(row.id);
}

async function calculateMedicineStreak(userId) {
  try {
    const medicines = await query(
      `SELECT id, days_of_week, start_date, end_date 
       FROM medicines 
       WHERE user_id = ? AND is_active = 1`,
      [userId]
    );

    if (medicines.length === 0) return 0;

    const parsedMeds = medicines.map(med => {
      let days = [];
      if (med.days_of_week) {
        if (typeof med.days_of_week === 'string') {
          try { days = JSON.parse(med.days_of_week); } catch (e) { days = []; }
        } else if (Array.isArray(med.days_of_week)) {
          days = med.days_of_week;
        }
      } else {
        days = [0, 1, 2, 3, 4, 5, 6];
      }
      return {
        id: med.id,
        days: new Set(days),
        start: columnDateOnly(med.start_date),
        end: columnDateOnly(med.end_date),
      };
    });

    const activeIds = parsedMeds.map(m => m.id);
    const timezone = await getUserTimezone(userId);
    const today = todayForTimezone(timezone);
    const sixtyDaysAgo = new Date(`${addDays(today, -60)}T00:00:00.000Z`);

    // Raw `taken_at` (not MySQL's `DATE(taken_at)`, which truncates using the DB
    // connection's session timezone) — the calendar day is derived in JS via
    // `dateOnlyForTimezone` instead, using this user's own stored timezone.
    const logs = await query(
      `SELECT medicine_id, taken_at
       FROM medicine_logs
       WHERE user_id = ? AND taken_at >= ? AND medicine_id IN (?)`,
      [userId, sixtyDaysAgo, activeIds]
    );

    if (logs.length === 0) return 0;

    const logsMap = new Map();
    for (const log of logs) {
      const dateStr = dateOnlyForTimezone(new Date(log.taken_at), timezone);
      if (!logsMap.has(dateStr)) {
        logsMap.set(dateStr, new Set());
      }
      logsMap.get(dateStr).add(log.medicine_id);
    }

    const checkComplianceAndSchedule = (dateStr) => {
      const dayOfWeek = new Date(`${dateStr}T00:00:00.000Z`).getUTCDay();

      const scheduledMeds = parsedMeds.filter(med => {
        if (!med.days.has(dayOfWeek)) return false;
        if (med.start && dateStr < med.start) return false;
        if (med.end && dateStr > med.end) return false;
        return true;
      });

      if (scheduledMeds.length === 0) {
        return { compliant: true, hadScheduled: false };
      }

      const takenMeds = logsMap.get(dateStr);
      if (!takenMeds) return { compliant: false, hadScheduled: true };

      for (const med of scheduledMeds) {
        if (!takenMeds.has(med.id)) return { compliant: false, hadScheduled: true };
      }
      return { compliant: true, hadScheduled: true };
    };

    let streak = 0;
    let actualTakenCount = 0;

    const todayRes = checkComplianceAndSchedule(today);
    let checkDate = today;

    if (todayRes.compliant) {
      streak = 1;
      if (todayRes.hadScheduled) {
        actualTakenCount++;
      }
      checkDate = addDays(checkDate, -1);
    } else {
      checkDate = addDays(checkDate, -1);
    }

    for (let i = 0; i < 60; i++) {
      const res = checkComplianceAndSchedule(checkDate);
      if (res.compliant) {
        streak++;
        if (res.hadScheduled) {
          actualTakenCount++;
        }
        checkDate = addDays(checkDate, -1);
      } else {
        break;
      }
    }

    if (actualTakenCount === 0) return 0;
    return streak;
  } catch (err) {
    console.error('[profiles] calculateMedicineStreak error:', err);
    return 0;
  }
}

async function getProfileById(userId) {
  const medStreak = await calculateMedicineStreak(userId);
  const rows = await query('SELECT * FROM profiles WHERE id = ? LIMIT 1', [userId]);
  const profile = parseProfileRow(rows[0] ?? null);
  if (profile) {
    profile.medicine_streak = medStreak;
  }
  return profile;
}

async function updateProfile(userId, email, patch) {
  const row = {
    id: userId,
    email: email ?? undefined,
    ...patch,
  };

  return upsertProfile(row);
}

/**
 * Called on every authenticated request (see requireJwtAuth middleware).
 * Streak is a resilience score, not a hard reset: +1 for each new UTC
 * calendar day the app is opened; if a day (or more) was missed, -5 for the
 * first missed day and -5 for each additional missed day, floored at 0,
 * then +1 for today. Backed by streak_activity_log (one row per active day)
 * so "This Week" / "This Month" / lifetime total-days can be rendered
 * without re-deriving history from a single last_active timestamp.
 */
async function touchLastActive(userId) {
  if (!userId) return;

  const rows = await query('SELECT streak, best_streak, timezone FROM profiles WHERE id = ? LIMIT 1', [userId]);
  const row = rows[0];
  if (!row) return;

  const todayStr = todayForTimezone(row.timezone || DEFAULT_TIMEZONE);

  const alreadyToday = await query(
    'SELECT id FROM streak_activity_log WHERE user_id = ? AND activity_date = ? LIMIT 1',
    [userId, todayStr],
  );
  if (alreadyToday.length > 0) {
    await execute('UPDATE profiles SET last_active = CURRENT_TIMESTAMP(3) WHERE id = ?', [userId]);
    return;
  }

  const lastRows = await query(
    'SELECT activity_date FROM streak_activity_log WHERE user_id = ? ORDER BY activity_date DESC LIMIT 1',
    [userId],
  );
  const lastDateStr = lastRows[0] ? columnDateOnly(lastRows[0].activity_date) : null;

  let newStreak;
  if (!lastDateStr) {
    newStreak = 1;
  } else {
    const gapDays = Math.round(
      (Date.parse(`${todayStr}T00:00:00.000Z`) - Date.parse(`${lastDateStr}T00:00:00.000Z`))
        / (24 * 60 * 60 * 1000),
    );
    if (gapDays <= 1) {
      newStreak = (row.streak || 0) + 1;
    } else {
      const missedDays = gapDays - 1;
      newStreak = Math.max(0, (row.streak || 0) - 5 * missedDays) + 1;
    }
  }

  const newBest = Math.max(row.best_streak || 0, newStreak);

  // The `alreadyToday` check above is a check-then-act race: touchLastActive fires on every
  // authenticated request (jwtAuth.middleware.js), and a typical screen load fires several in
  // parallel, so two requests can both pass that check before either inserts. `INSERT IGNORE`'s
  // own affectedRows is the real, race-safe signal for "did *this* call win today's claim" —
  // gate both the streak update and the notification on it, not just the earlier SELECT.
  const claim = await execute(
    'INSERT IGNORE INTO streak_activity_log (id, user_id, activity_date) VALUES (UUID(), ?, ?)',
    [userId, todayStr],
  );
  if (claim.affectedRows === 0) return;

  await execute(
    'UPDATE profiles SET streak = ?, best_streak = ?, last_active = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [newStreak, newBest, userId],
  );

  try {
    await notifyGuardiansOfElder(userId, {
      type: 'streak_maintained',
      title: 'Keep Your Streak',
      body: 'The user has maintained their wellness streak today.',
      data: { type: 'streak_maintained', elderId: userId },
    });
  } catch (err) {
    console.warn('[touchLastActive] guardian notify failed:', err.message);
  }
}

module.exports = {
  upsertProfile,
  getProfileById,
  updateProfile,
  touchLastActive,
};
