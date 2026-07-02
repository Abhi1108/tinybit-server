const { query, execute } = require('../config/mysql');

const PROFILE_JSON_COLUMNS = new Set(['medical_conditions', 'allergies']);

const PROFILE_UPDATE_DEFAULTS = {
  plan_type: 'free',
  plan_status: 'active',
  plan_currency: 'INR',
  streak: 0,
};

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
        start: med.start_date ? new Date(med.start_date) : null,
        end: med.end_date ? new Date(med.end_date) : null,
      };
    });

    const activeIds = parsedMeds.map(m => m.id);

    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    sixtyDaysAgo.setHours(0, 0, 0, 0);

    const logs = await query(
      `SELECT medicine_id, DATE(taken_at) AS taken_date 
       FROM medicine_logs 
       WHERE user_id = ? AND taken_at >= ? AND medicine_id IN (?)`,
      [userId, sixtyDaysAgo, activeIds]
    );

    if (logs.length === 0) return 0;

    const logsMap = new Map();
    for (const log of logs) {
      const dateStr = log.taken_date instanceof Date
        ? log.taken_date.toISOString().slice(0, 10)
        : String(log.taken_date).slice(0, 10);
      if (!logsMap.has(dateStr)) {
        logsMap.set(dateStr, new Set());
      }
      logsMap.get(dateStr).add(log.medicine_id);
    }

    const checkComplianceAndSchedule = (date) => {
      const dateStr = date.toISOString().slice(0, 10);
      const dayOfWeek = date.getDay();

      const scheduledMeds = parsedMeds.filter(med => {
        if (!med.days.has(dayOfWeek)) return false;
        if (med.start && date < med.start) return false;
        if (med.end && date > med.end) return false;
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayRes = checkComplianceAndSchedule(today);
    let checkDate = new Date(today);

    if (todayRes.compliant) {
      streak = 1;
      if (todayRes.hadScheduled) {
        actualTakenCount++;
      }
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    for (let i = 0; i < 60; i++) {
      const current = new Date(checkDate);
      const res = checkComplianceAndSchedule(current);
      if (res.compliant) {
        streak++;
        if (res.hadScheduled) {
          actualTakenCount++;
        }
        checkDate.setDate(checkDate.getDate() - 1);
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
    email: email ?? null,
    ...PROFILE_UPDATE_DEFAULTS,
    ...patch,
  };

  return upsertProfile(row);
}

/**
 * Called on every authenticated request (see requireJwtAuth middleware).
 * Streak now means "consecutive calendar days the app was opened" — same
 * day as last_active is a no-op, exactly one day later increments, any
 * larger gap (or first time) resets to 1. Day boundaries are UTC, matching
 * the rest of this codebase's date-string comparisons.
 */
async function touchLastActive(userId) {
  if (!userId) return;

  const rows = await query('SELECT streak, last_active FROM profiles WHERE id = ? LIMIT 1', [userId]);
  const row = rows[0];
  if (!row) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const prevStr = row.last_active ? new Date(row.last_active).toISOString().slice(0, 10) : null;

  if (prevStr === todayStr) {
    await execute('UPDATE profiles SET last_active = CURRENT_TIMESTAMP(3) WHERE id = ?', [userId]);
    return;
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const newStreak = prevStr === yesterdayStr ? (row.streak || 0) + 1 : 1;
  await execute(
    'UPDATE profiles SET streak = ?, last_active = CURRENT_TIMESTAMP(3) WHERE id = ?',
    [newStreak, userId],
  );
}

module.exports = {
  upsertProfile,
  getProfileById,
  updateProfile,
  touchLastActive,
};
