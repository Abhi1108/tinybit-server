const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const CARE_EVENT_SELECT = `
  id, user_id, title, sub, time, type, color, emoji, date, month, year, timestamp, created_at
`;

const WRITABLE_COLUMNS = [
  'title', 'sub', 'time', 'type', 'color', 'emoji', 'date', 'month', 'year', 'timestamp'
];

const VALID_TYPES = ['Doctor', 'Family', 'Therapy', 'Activity', 'Medicine', 'Wellness'];

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapCareEventRow(row) {
  if (!row) return null;

  return {
    ...row,
    date: row.date == null ? null : Number(row.date),
    year: row.year == null ? null : Number(row.year),
    timestamp: row.timestamp == null ? null : Number(row.timestamp),
    created_at: toIsoString(row.created_at),
  };
}

function pickWritableFields(row) {
  const out = {};
  for (const key of WRITABLE_COLUMNS) {
    if (row[key] !== undefined) {
      out[key] = row[key];
    }
  }
  return out;
}

async function getById(userId, id) {
  const rows = await query(
    `SELECT ${CARE_EVENT_SELECT}
     FROM care_events
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [id, userId],
  );
  return mapCareEventRow(rows[0] ?? null);
}

async function listByUser(userId) {
  const rows = await query(
    `SELECT ${CARE_EVENT_SELECT}
     FROM care_events
     WHERE user_id = ?
     ORDER BY timestamp ASC`,
    [userId],
  );
  return rows.map(mapCareEventRow);
}

async function create(userId, rawRow) {
  const fields = pickWritableFields(rawRow);

  if (!fields.title?.trim()) {
    const err = new Error('Title is required');
    err.statusCode = 400;
    throw err;
  }

  const type = fields.type || 'Doctor';
  if (!VALID_TYPES.includes(type)) {
    const err = new Error(`Invalid care event type: ${type}`);
    err.statusCode = 400;
    throw err;
  }

  const id = randomUUID();
  const columns = ['id', 'user_id', ...Object.keys(fields)];
  const values = [id, userId, ...Object.values(fields)];
  const placeholders = columns.map(() => '?').join(', ');

  await execute(
    `INSERT INTO care_events (${columns.join(', ')})
     VALUES (${placeholders})`,
    values
  );

  return getById(userId, id);
}

async function update(userId, id, rawRow) {
  const fields = pickWritableFields(rawRow);
  if (Object.keys(fields).length === 0) {
    return getById(userId, id);
  }

  if (fields.type !== undefined && !VALID_TYPES.includes(fields.type)) {
    const err = new Error(`Invalid care event type: ${fields.type}`);
    err.statusCode = 400;
    throw err;
  }

  const updates = [];
  const values = [];
  for (const [key, val] of Object.entries(fields)) {
    updates.push(`\`${key}\` = ?`);
    values.push(val);
  }

  values.push(id, userId);

  const result = await execute(
    `UPDATE care_events
     SET ${updates.join(', ')}
     WHERE id = ? AND user_id = ?`,
    values
  );

  if (!result.affectedRows) return null;
  return getById(userId, id);
}

async function deleteEvent(userId, id) {
  const result = await execute(
    `DELETE FROM care_events
     WHERE id = ? AND user_id = ?`,
    [id, userId]
  );
  return !!result.affectedRows;
}

module.exports = {
  getById,
  listByUser,
  create,
  update,
  deleteEvent,
};
