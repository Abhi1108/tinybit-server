const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const MESSAGE_SELECT = `
  fm.id, fm.sender_id, fm.receiver_id, fm.message, fm.created_at
`;

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapMessageRow(row) {
  if (!row) return null;

  const sender = row.sender_full_name
    ? { full_name: row.sender_full_name }
    : null;

  return {
    id: row.id,
    sender_id: row.sender_id,
    receiver_id: row.receiver_id,
    message: row.message,
    content: row.message,
    created_at: toIsoString(row.created_at),
    ...(sender ? { sender } : {}),
  };
}

async function getById(id) {
  const rows = await query(
    `SELECT ${MESSAGE_SELECT}, p.full_name AS sender_full_name
     FROM family_messages fm
     LEFT JOIN profiles p ON p.id = fm.sender_id
     WHERE fm.id = ?
     LIMIT 1`,
    [id],
  );
  return mapMessageRow(rows[0] ?? null);
}

async function latestForReceiver(receiverId) {
  const rows = await query(
    `SELECT ${MESSAGE_SELECT}, p.full_name AS sender_full_name
     FROM family_messages fm
     LEFT JOIN profiles p ON p.id = fm.sender_id
     WHERE fm.receiver_id = ?
     ORDER BY fm.created_at DESC
     LIMIT 1`,
    [receiverId],
  );
  return mapMessageRow(rows[0] ?? null);
}

async function countForReceiverOnDate(receiverId, date) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM family_messages
     WHERE receiver_id = ?
       AND DATE(created_at) = ?`,
    [receiverId, date],
  );
  return Number(rows[0]?.count ?? 0);
}

async function create(senderId, receiverId, message) {
  const id = randomUUID();

  await execute(
    `INSERT INTO family_messages (id, sender_id, receiver_id, message)
     VALUES (?, ?, ?, ?)`,
    [id, senderId, receiverId, message],
  );

  return getById(id);
}

module.exports = {
  latestForReceiver,
  countForReceiverOnDate,
  create,
};
