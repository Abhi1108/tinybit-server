const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const JOURNAL_SELECT = `
  id, user_id, type, content, audio_uri, prompt, created_at
`;

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapJournalRow(row) {
  if (!row) return null;

  return {
    ...row,
    created_at: toIsoString(row.created_at),
  };
}

async function getById(userId, id) {
  const rows = await query(
    `SELECT ${JOURNAL_SELECT}
     FROM journal
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [id, userId],
  );
  return mapJournalRow(rows[0] ?? null);
}

async function listByUser(userId) {
  const rows = await query(
    `SELECT ${JOURNAL_SELECT}
     FROM journal
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map(mapJournalRow);
}

async function countByUser(userId) {
  const rows = await query(
    `SELECT COUNT(*) AS count
     FROM journal
     WHERE user_id = ?`,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function create(userId, { type, content, audio_uri = null, prompt = null }) {
  const id = randomUUID();

  await execute(
    `INSERT INTO journal (id, user_id, type, content, audio_uri, prompt)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, type, content, audio_uri, prompt],
  );

  return getById(userId, id);
}

module.exports = {
  listByUser,
  countByUser,
  create,
};
