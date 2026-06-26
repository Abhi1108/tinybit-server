const { query, execute } = require('../config/mysql');

const TRACK_SELECT = `
  id, category, title, subtitle, duration_seconds, duration_label,
  icon_name, icon_url, audio_url, sort_order, is_active, created_at, updated_at
`;

const VALID_CATEGORIES = new Set(['bhajans', 'meditation', 'jokes_fun', 'nature_sounds']);

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapTrackRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    category: row.category,
    title: row.title,
    subtitle: row.subtitle ?? null,
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    duration_label: row.duration_label ?? null,
    icon_name: row.icon_name ?? null,
    icon_url: row.icon_url ?? null,
    audio_url: row.audio_url,
    sort_order: Number(row.sort_order ?? 0),
    is_active: Boolean(row.is_active),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

async function listByCategory(category) {
  if (!VALID_CATEGORIES.has(category)) {
    return [];
  }

  const rows = await query(
    `SELECT ${TRACK_SELECT}
     FROM mood_media_tracks
     WHERE category = ? AND is_active = 1
     ORDER BY sort_order ASC, title ASC`,
    [category],
  );
  return rows.map(mapTrackRow);
}

async function listFavorites(userId) {
  const rows = await query(
    `SELECT ${TRACK_SELECT.split(',').map((col) => `t.${col.trim()}`).join(', ')}
     FROM mood_media_tracks t
     INNER JOIN mood_media_favorites f ON f.track_id = t.id
     WHERE f.user_id = ? AND t.is_active = 1
     ORDER BY f.created_at DESC`,
    [userId],
  );
  return rows.map(mapTrackRow);
}

async function addFavorite(userId, trackId) {
  await execute(
    `INSERT INTO mood_media_favorites (user_id, track_id)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE created_at = created_at`,
    [userId, trackId],
  );
  return { user_id: userId, track_id: trackId };
}

async function removeFavorite(userId, trackId) {
  const result = await execute(
    `DELETE FROM mood_media_favorites
     WHERE user_id = ? AND track_id = ?`,
    [userId, trackId],
  );

  if (!result.affectedRows) return null;
  return { user_id: userId, track_id: trackId };
}

module.exports = {
  listByCategory,
  listFavorites,
  addFavorite,
  removeFavorite,
};
