const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const UPSERT_FIELDS = [
  'mood',
  'mood_score',
  'sleep_rested',
  'breakfast_done',
  'hydration_done',
  'pain_reported',
  'water_glasses',
  'medicines_taken',
  'sleep_quality',
  'sleep_hours',
  'energy_level',
  'pain_level',
  'physical_activity',
  'voice_note_url',
  'voice_note_duration',
  'notes',
];

const BOOL_FIELDS = new Set([
  'sleep_rested',
  'breakfast_done',
  'hydration_done',
  'pain_reported',
  'medicines_taken',
]);

const TEXT_FIELDS = new Set(['sleep_quality', 'energy_level']);

function toDateStr(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapDailyCheckInRow(row) {
  if (!row) return null;

  return {
    ...row,
    check_in_date: toDateStr(row.check_in_date),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
    sleep_rested: row.sleep_rested == null ? null : Boolean(row.sleep_rested),
    breakfast_done: row.breakfast_done == null ? null : Boolean(row.breakfast_done),
    hydration_done: row.hydration_done == null ? null : Boolean(row.hydration_done),
    pain_reported: row.pain_reported == null ? null : Boolean(row.pain_reported),
    medicines_taken: row.medicines_taken == null ? null : Boolean(row.medicines_taken),
  };
}

function pickUpsertFields(fields) {
  const out = {};
  for (const key of UPSERT_FIELDS) {
    if (fields[key] === undefined) continue;

    let value = fields[key];
    if (BOOL_FIELDS.has(key) && value != null) {
      value = value ? 1 : 0;
    } else if (TEXT_FIELDS.has(key) && value != null) {
      value = String(value);
    }
    out[key] = value;
  }
  return out;
}

async function findCheckInByUserAndDate(userId, date) {
  const rows = await query(
    `SELECT *
     FROM daily_checkins
     WHERE user_id = ? AND check_in_date = ?
     LIMIT 1`,
    [userId, date],
  );
  return mapDailyCheckInRow(rows[0] ?? null);
}

async function upsertDailyCheckIn(userId, fields) {
  const picked = pickUpsertFields(fields);
  const checkInDate = fields.check_in_date;
  const columns = ['id', 'user_id', 'check_in_date', ...Object.keys(picked)];
  const id = randomUUID();
  const values = [id, userId, checkInDate, ...Object.values(picked)];

  const placeholders = columns.map(() => '?').join(', ');
  const updates = Object.keys(picked)
    .map((col) => `${col} = VALUES(${col})`)
    .join(', ');

  await execute(
    `INSERT INTO daily_checkins (${columns.join(', ')})
     VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
    values,
  );

  return findCheckInByUserAndDate(userId, checkInDate);
}

module.exports = {
  findCheckInByUserAndDate,
  upsertDailyCheckIn,
};
