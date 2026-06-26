const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function normalizeReadings(userId, readings) {
  return readings
    .map((row) => ({
      user_id: userId,
      type: String(row.vital_type ?? row.type ?? '').trim(),
      value: Number(row.value),
      unit: String(row.unit ?? '').trim() || null,
    }))
    .filter((row) => row.type && Number.isFinite(row.value));
}

async function insertHealthReadings(userId, readings) {
  const rows = normalizeReadings(userId, readings);
  if (rows.length === 0) return 0;

  const placeholders = rows.map(() => '(?, ?, ?, ?, ?)').join(', ');
  const values = rows.flatMap((row) => [
    randomUUID(),
    userId,
    row.type,
    row.value,
    row.unit,
  ]);

  await execute(
    `INSERT INTO health_readings (id, user_id, \`type\`, value, unit)
     VALUES ${placeholders}`,
    values,
  );

  return rows.length;
}

function mapRow(row) {
  if (!row) return null;
  const created = row.created_at instanceof Date
    ? row.created_at.toISOString()
    : String(row.created_at);
  return {
    id: row.id,
    user_id: row.user_id,
    vital_type: row.type,
    type: row.type,
    value: row.value == null ? null : Number(row.value),
    unit: row.unit,
    recorded_at: created,
    created_at: created,
  };
}

async function listByUser(userId, { limit = 50 } = {}) {
  const rows = await query(
    `SELECT id, user_id, \`type\`, value, unit, created_at
     FROM health_readings
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [userId, Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map(mapRow);
}

module.exports = {
  insertHealthReadings,
  listByUser,
};
