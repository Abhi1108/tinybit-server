const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

async function getChatHistory(userId, limit = 50) {
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const rows = await query(
    `SELECT id, user_id, role, content, provider,
            prompt_tokens, completion_tokens, total_tokens, cached_tokens, created_at
     FROM ai_conversations
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ${limitNum}`,
    [userId]
  );
  // Order DESC for database query, but reverse to ASC (chronological) for the client / AI model
  return rows.map(mapRow).reverse();
}

async function saveMessage(userId, {
  role,
  content,
  provider = null,
  prompt_tokens = null,
  completion_tokens = null,
  total_tokens = null,
  cached_tokens = null,
}) {
  const id = randomUUID();
  await execute(
    `INSERT INTO ai_conversations
       (id, user_id, role, content, provider, prompt_tokens, completion_tokens, total_tokens, cached_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, userId, role, content, provider, prompt_tokens, completion_tokens, total_tokens, cached_tokens]
  );
  const rows = await query(
    `SELECT id, user_id, role, content, provider,
            prompt_tokens, completion_tokens, total_tokens, cached_tokens, created_at
     FROM ai_conversations
     WHERE id = ? LIMIT 1`,
    [id]
  );
  return mapRow(rows[0] ?? null);
}

async function clearHistory(userId) {
  await execute(`DELETE FROM ai_conversations WHERE user_id = ?`, [userId]);
}

module.exports = {
  getChatHistory,
  saveMessage,
  clearHistory,
};
