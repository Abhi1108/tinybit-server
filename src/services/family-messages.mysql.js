const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const MESSAGE_SELECT = `
  fm.id, fm.sender_id, fm.receiver_id, fm.message, fm.audio_url, fm.created_at
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
    audio_url: row.audio_url ?? null,
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

/** Full two-way thread between `userId` and `otherUserId`, newest first. */
async function listBetween(userId, otherUserId, limit = 50) {
  // `LIMIT ?` as a mysql2 prepared-statement placeholder throws "Incorrect arguments to
  // mysqld_stmt_execute" (a known mysql2 limitation, not consistently supported across
  // versions). Safe to inline here since `safeLimit` is clamped to a plain integer below,
  // never raw user input.
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

  const rows = await query(
    `SELECT ${MESSAGE_SELECT}, p.full_name AS sender_full_name
     FROM family_messages fm
     LEFT JOIN profiles p ON p.id = fm.sender_id
     WHERE (fm.sender_id = ? AND fm.receiver_id = ?)
        OR (fm.sender_id = ? AND fm.receiver_id = ?)
     ORDER BY fm.created_at DESC
     LIMIT ${safeLimit}`,
    [userId, otherUserId, otherUserId, userId],
  );
  return rows.map(mapMessageRow);
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

async function create(senderId, receiverId, message, audioUrl = null) {
  const id = randomUUID();

  await execute(
    `INSERT INTO family_messages (id, sender_id, receiver_id, message, audio_url)
     VALUES (?, ?, ?, ?, ?)`,
    [id, senderId, receiverId, message, audioUrl],
  );

  return getById(id);
}

/** Confirms `senderId`/`receiverId` is a participant in the message that owns `audioUrl`. */
async function isParticipantInAudioMessage(userId, audioUrl) {
  const rows = await query(
    `SELECT id FROM family_messages
     WHERE audio_url = ? AND (sender_id = ? OR receiver_id = ?)
     LIMIT 1`,
    [audioUrl, userId, userId],
  );
  return rows.length > 0;
}

module.exports = {
  listBetween,
  latestForReceiver,
  countForReceiverOnDate,
  create,
  isParticipantInAudioMessage,
};
