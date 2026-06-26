const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const APPOINTMENT_SELECT = `
  id, user_id, doctor_name, specialty, date, time, fee, reason, status, created_at
`;

const WRITABLE_COLUMNS = [
  'doctor_name', 'specialty', 'date', 'time', 'fee', 'reason', 'status',
];

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapAppointmentRow(row) {
  if (!row) return null;

  return {
    ...row,
    created_at: toIsoString(row.created_at),
  };
}

function pickWritableFields(row) {
  const {
    user_id: _ignoredUserId,
    id: _ignoredId,
    created_at: _ignoredCreatedAt,
    ...fields
  } = row ?? {};

  const out = {};
  for (const key of WRITABLE_COLUMNS) {
    if (fields[key] === undefined) continue;
    out[key] = fields[key];
  }
  return out;
}

async function getById(userId, id) {
  const rows = await query(
    `SELECT ${APPOINTMENT_SELECT}
     FROM appointments
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [id, userId],
  );
  return mapAppointmentRow(rows[0] ?? null);
}

async function listByUser(userId) {
  const rows = await query(
    `SELECT ${APPOINTMENT_SELECT}
     FROM appointments
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapAppointmentRow);
}

async function create(userId, rawRow) {
  const fields = pickWritableFields(rawRow);
  if (fields.status === undefined) {
    fields.status = 'upcoming';
  }

  const id = randomUUID();
  const columns = ['id', 'user_id', ...Object.keys(fields)];
  const values = [id, userId, ...Object.values(fields)];
  const placeholders = columns.map(() => '?').join(', ');

  await execute(
    `INSERT INTO appointments (${columns.join(', ')})
     VALUES (${placeholders})`,
    values,
  );

  return getById(userId, id);
}

async function updateStatus(userId, id, status) {
  const result = await execute(
    `UPDATE appointments
     SET status = ?
     WHERE id = ? AND user_id = ?`,
    [status, id, userId],
  );

  if (!result.affectedRows) return null;
  return getById(userId, id);
}

module.exports = {
  listByUser,
  create,
  updateStatus,
};
