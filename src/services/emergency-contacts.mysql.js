const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const CONTACT_COLUMNS = 'id, name, role, phone, color';

async function fetchContact(userId, contactId) {
  const rows = await query(
    `SELECT ${CONTACT_COLUMNS}
     FROM emergency_contacts
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [contactId, userId],
  );
  return rows[0] ?? null;
}

async function listByUserId(userId) {
  return query(
    `SELECT ${CONTACT_COLUMNS}
     FROM emergency_contacts
     WHERE user_id = ?
     ORDER BY created_at ASC`,
    [userId],
  );
}

async function create(userId, { name, role, phone, color }) {
  const id = randomUUID();
  await execute(
    `INSERT INTO emergency_contacts (id, user_id, name, role, phone, color)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, name, role, phone, color],
  );
  return fetchContact(userId, id);
}

async function update(userId, contactId, patch) {
  const sets = [];
  const params = [];

  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.role !== undefined) {
    sets.push('role = ?');
    params.push(patch.role);
  }
  if (patch.phone !== undefined) {
    sets.push('phone = ?');
    params.push(patch.phone);
  }
  if (patch.color !== undefined) {
    sets.push('color = ?');
    params.push(patch.color);
  }

  if (sets.length === 0) {
    return fetchContact(userId, contactId);
  }

  params.push(contactId, userId);
  const result = await execute(
    `UPDATE emergency_contacts
     SET ${sets.join(', ')}
     WHERE id = ? AND user_id = ?`,
    params,
  );

  if (result.affectedRows === 0) return null;
  return fetchContact(userId, contactId);
}

async function remove(userId, contactId) {
  const result = await execute(
    `DELETE FROM emergency_contacts
     WHERE id = ? AND user_id = ?`,
    [contactId, userId],
  );

  if (result.affectedRows === 0) return null;
  return { id: contactId };
}

module.exports = {
  listByUserId,
  create,
  update,
  remove,
};
