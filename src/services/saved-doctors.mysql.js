const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapDoctorRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    created_at: toIsoString(row.created_at),
  };
}

async function listByUser(userId) {
  const rows = await query(
    'SELECT id, name, phone, created_at FROM saved_doctors WHERE user_id = ? ORDER BY created_at ASC',
    [userId],
  );
  return rows.map(mapDoctorRow);
}

async function create(userId, { name, phone }) {
  const safeName = String(name ?? '').trim();
  const safePhone = String(phone ?? '').trim();

  if (!safeName) {
    const err = new Error('Doctor name is required.');
    err.statusCode = 400;
    throw err;
  }
  if (!safePhone) {
    const err = new Error('Doctor phone number is required.');
    err.statusCode = 400;
    throw err;
  }

  const id = randomUUID();
  await execute(
    'INSERT INTO saved_doctors (id, user_id, name, phone) VALUES (?, ?, ?, ?)',
    [id, userId, safeName, safePhone],
  );

  const rows = await query(
    'SELECT id, name, phone, created_at FROM saved_doctors WHERE id = ? LIMIT 1',
    [id],
  );
  return mapDoctorRow(rows[0]);
}

async function deleteById(userId, id) {
  const result = await execute(
    'DELETE FROM saved_doctors WHERE id = ? AND user_id = ?',
    [id, userId],
  );
  return result.affectedRows > 0;
}

module.exports = { listByUser, create, deleteById };
