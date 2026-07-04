const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const careEventsService = require('./care-events.service');

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

  // Auto-create matching care event if date is present and parseable
  if (fields.date) {
    try {
      const parsedDate = new Date(fields.date);
      if (!isNaN(parsedDate.getTime())) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const careEventData = {
          title: `Appointment: ${fields.doctor_name || 'Doctor'}`,
          sub: `${fields.specialty || ''}${fields.specialty && fields.reason ? ' - ' : ''}${fields.reason || ''}`.trim() || 'Scheduled doctor visit',
          time: fields.time || '',
          type: 'Doctor',
          color: '#DB5461',
          emoji: '🏥',
          date: parsedDate.getDate(),
          month: monthNames[parsedDate.getMonth()],
          year: parsedDate.getFullYear(),
          timestamp: parsedDate.getTime(),
        };
        await careEventsService.create(userId, careEventData);
      }
    } catch (careEventErr) {
      console.warn('[appointments] Failed to auto-create care event:', careEventErr.message);
    }
  }

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
