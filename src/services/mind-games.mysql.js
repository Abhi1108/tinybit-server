const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapScoreRow(row) {
  if (!row) return null;

  return {
    ...row,
    score: row.score == null ? 0 : Number(row.score),
    created_at: toIsoString(row.created_at),
  };
}

async function insertScore(userId, { game_type: gameType, score, duration_seconds: durationSeconds }) {
  const id = randomUUID();
  const normalizedScore = Math.max(0, Number(score) || 0);
  const normalizedType = String(gameType ?? '').trim();
  const normalizedDuration = Math.max(0, Number(durationSeconds) || 0);

  await execute(
    `INSERT INTO mind_games_scores (id, user_id, game_type, score, duration_seconds)
     VALUES (?, ?, ?, ?, ?)`,
    [id, userId, normalizedType, normalizedScore, normalizedDuration],
  );

  const rows = await query(
    `SELECT id, user_id, game_type, score, duration_seconds, created_at
     FROM mind_games_scores
     WHERE id = ?
     LIMIT 1`,
    [id],
  );

  return mapScoreRow(rows[0] ?? null);
}

async function getUserStats(userId) {
  const [todayRows, totalRows, rankRows] = await Promise.all([
    query(
      `SELECT score, duration_seconds
       FROM mind_games_scores
       WHERE user_id = ? AND created_at >= CURDATE()`,
      [userId],
    ),
    query(
      `SELECT score
       FROM mind_games_scores
       WHERE user_id = ?`,
      [userId],
    ),
    query(
      `SELECT user_id, SUM(score) AS total
       FROM mind_games_scores
       GROUP BY user_id
       ORDER BY total DESC`,
    ),
  ]);

  const todayScore = todayRows.reduce((sum, row) => sum + Number(row.score), 0);
  const totalScore = totalRows.reduce((sum, row) => sum + Number(row.score), 0);
  const todayDurationSeconds = todayRows.reduce((sum, row) => sum + Number(row.duration_seconds ?? 0), 0);
  const playTime = Math.round(todayDurationSeconds / 60);

  const rankIdx = rankRows.findIndex((row) => row.user_id === userId);
  const rank = rankIdx >= 0 ? rankIdx + 1 : '—';

  return { todayScore, totalScore, rank, playTime };
}

async function getLeaderboard(limit = 5) {
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 5));

  const rows = await query(
    `SELECT m.user_id, SUM(m.score) AS total_score,
            p.full_name, p.location
     FROM mind_games_scores m
     LEFT JOIN profiles p ON p.id = m.user_id
     GROUP BY m.user_id, p.full_name, p.location
     ORDER BY total_score DESC
     LIMIT ${limitNum}`,
  );

  return rows.map((row) => ({
    userId: row.user_id,
    name: row.full_name ?? 'User',
    location: row.location ?? '',
    score: Number(row.total_score) || 0,
  }));
}

module.exports = {
  insertScore,
  getUserStats,
  getLeaderboard,
};
