const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const MEDICINE_SELECT = `
  id, user_id, name, generic_name, dosage, dosage_unit,
  schedule_time, time, days_of_week, instruction, notes,
  prescribed_by, frequency, start_date, end_date, is_recurring,
  priority, category, stock, total_stock, is_active,
  snooze_minutes, meal_timing, created_at
`;

const WRITABLE_COLUMNS = [
  'name', 'generic_name', 'dosage', 'dosage_unit', 'schedule_time', 'time',
  'days_of_week', 'instruction', 'instructions', 'notes', 'prescribed_by',
  'frequency', 'meal_timing', 'start_date', 'end_date', 'is_recurring',
  'priority', 'category', 'stock', 'total_stock', 'is_active',
  'snooze_minutes', 'doctor_phone',
];

const BOOL_COLUMNS = new Set(['is_recurring', 'is_active']);
const JSON_COLUMNS = new Set(['days_of_week']);

function toDateStr(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJsonArray(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function mapMedicineRow(row) {
  if (!row) return null;

  return {
    ...row,
    days_of_week: parseJsonArray(row.days_of_week),
    is_recurring: Boolean(row.is_recurring),
    is_active: Boolean(row.is_active),
    start_date: toDateStr(row.start_date),
    end_date: toDateStr(row.end_date),
    created_at: toIsoString(row.created_at),
    stock: row.stock == null ? null : Number(row.stock),
    total_stock: row.total_stock == null ? null : Number(row.total_stock),
    snooze_minutes: row.snooze_minutes == null ? null : Number(row.snooze_minutes),
  };
}

function stripProtectedFields(row) {
  const {
    user_id: _ignoredUserId,
    id: _ignoredId,
    created_at: _ignoredCreatedAt,
    updated_at: _ignoredUpdatedAt,
    ...fields
  } = row ?? {};
  return fields;
}

function pickWritableFields(row) {
  const fields = stripProtectedFields(row);
  const out = {};

  for (const key of WRITABLE_COLUMNS) {
    if (fields[key] === undefined) continue;
    let value = fields[key];

    if (JSON_COLUMNS.has(key) && value != null && typeof value === 'object') {
      value = JSON.stringify(value);
    } else if (BOOL_COLUMNS.has(key) && value != null) {
      value = value ? 1 : 0;
    }

    out[key] = value;
  }

  return out;
}

async function listByUser(userId, { activeOnly = true } = {}) {
  const sql = activeOnly
    ? `SELECT ${MEDICINE_SELECT}
       FROM medicines
       WHERE user_id = ? AND is_active = 1
       ORDER BY created_at DESC`
    : `SELECT ${MEDICINE_SELECT}
       FROM medicines
       WHERE user_id = ?
       ORDER BY created_at DESC`;

  const rows = await query(sql, [userId]);
  return rows.map(mapMedicineRow);
}

async function getById(userId, id) {
  const rows = await query(
    `SELECT ${MEDICINE_SELECT}
     FROM medicines
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [id, userId],
  );
  return mapMedicineRow(rows[0] ?? null);
}

async function create(userId, rawRows) {
  const createdIds = [];

  for (const rawRow of rawRows) {
    const fields = pickWritableFields(rawRow);
    const id = randomUUID();
    const columns = ['id', 'user_id', ...Object.keys(fields)];
    const values = [id, userId, ...Object.values(fields)];
    const placeholders = columns.map(() => '?').join(', ');

    await execute(
      `INSERT INTO medicines (${columns.join(', ')})
       VALUES (${placeholders})`,
      values,
    );

    createdIds.push(id);
  }

  const created = [];
  for (const id of createdIds) {
    const row = await getById(userId, id);
    if (row) created.push(row);
  }
  return created;
}

async function update(userId, id, patch) {
  const fields = pickWritableFields(patch);
  const keys = Object.keys(fields);
  if (keys.length === 0) return null;

  const sets = keys.map((key) => `${key} = ?`).join(', ');
  const values = [...Object.values(fields), id, userId];

  const result = await execute(
    `UPDATE medicines SET ${sets} WHERE id = ? AND user_id = ?`,
    values,
  );

  if (!result.affectedRows) return null;
  return getById(userId, id);
}

async function deleteById(userId, id) {
  const result = await execute(
    'DELETE FROM medicines WHERE id = ? AND user_id = ?',
    [id, userId],
  );

  if (!result.affectedRows) return null;
  return { id };
}

module.exports = {
  listByUser,
  getById,
  create,
  update,
  delete: deleteById,
};
