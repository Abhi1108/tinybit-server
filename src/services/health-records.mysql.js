const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const storageService = require('./storage.service');
const { isStorageConfigured } = require('../config/storage');

const RECORD_SELECT = `
  id, user_id, title, date, timestamp, size, \`type\`, category,
  icon_name, badge_bg, badge_color, uri, mime_type, ai_read,
  ai_insights, ai_insights_at, created_at
`;

// Editable via PATCH /records/:id and the initial POST /records create — NOT
// ai_insights/ai_insights_at, which are only ever written via saveInsights().
const WRITABLE_COLUMNS = [
  'title', 'date', 'timestamp', 'size', 'type', 'category',
  'icon_name', 'badge_bg', 'badge_color', 'uri', 'mime_type', 'ai_read',
];

const BOOL_COLUMNS = new Set(['ai_read']);

// UTC calendar-day boundaries — same house convention used elsewhere (streaks,
// calorie tracker "today") rather than the user's local midnight.
const DATE_RANGES = new Set(['today', 'this_week', 'this_month', 'all_time']);

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function parseJsonColumn(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapRecordRow(row) {
  if (!row) return null;

  return {
    ...row,
    timestamp: row.timestamp == null ? null : Number(row.timestamp),
    ai_read: Boolean(row.ai_read),
    ai_insights: parseJsonColumn(row.ai_insights),
    ai_insights_at: toIsoString(row.ai_insights_at),
    created_at: toIsoString(row.created_at),
  };
}

function dateRangeStartMs(dateRange) {
  if (!DATE_RANGES.has(dateRange) || dateRange === 'all_time') return null;

  const now = new Date();
  const startOfTodayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  if (dateRange === 'today') return startOfTodayUtc;
  if (dateRange === 'this_week') return startOfTodayUtc - 6 * 24 * 60 * 60 * 1000;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1); // this_month
}

function stripProtectedFields(row) {
  const {
    user_id: _ignoredUserId,
    id: _ignoredId,
    created_at: _ignoredCreatedAt,
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

    if (BOOL_COLUMNS.has(key) && value != null) {
      value = value ? 1 : 0;
    }

    out[key] = value;
  }

  return out;
}

async function getById(userId, id) {
  const rows = await query(
    `SELECT ${RECORD_SELECT}
     FROM health_records
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [id, userId],
  );
  return mapRecordRow(rows[0] ?? null);
}

async function listByUser(userId, { category, dateRange } = {}) {
  const conditions = ['user_id = ?'];
  const params = [userId];

  if (category && category !== 'All') {
    conditions.push('category = ?');
    params.push(category);
  }

  const rangeStart = dateRangeStartMs(dateRange);
  if (rangeStart != null) {
    conditions.push('timestamp >= ?');
    params.push(rangeStart);
  }

  const rows = await query(
    `SELECT ${RECORD_SELECT}
     FROM health_records
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp DESC`,
    params,
  );
  return rows.map(mapRecordRow);
}

async function create(userId, record) {
  const fields = pickWritableFields(record);
  const id = randomUUID();
  const columns = ['id', 'user_id', ...Object.keys(fields)];
  const values = [id, userId, ...Object.values(fields)];
  const placeholders = columns.map(() => '?').join(', ');

  const columnList = columns.map((col) => (col === 'type' ? '`type`' : col)).join(', ');

  await execute(
    `INSERT INTO health_records (${columnList})
     VALUES (${placeholders})`,
    values,
  );

  return getById(userId, id);
}

async function deleteById(userId, id) {
  const record = await getById(userId, id);
  if (!record) return null;

  if (record.uri) {
    try {
      const key = storageService.extractObjectKey(record.uri);
      const segments = key ? key.split('/') : [];
      if (segments.length >= 3 && storageService.VALID_PURPOSES.has(segments[0])) {
        if (isStorageConfigured()) {
          await storageService.deleteObject(key, userId);
        }
      }
    } catch (err) {
      console.warn(`[health-records] Failed to delete S3 object for record ${id}:`, err.message);
    }
  }

  const result = await execute(
    'DELETE FROM health_records WHERE id = ? AND user_id = ?',
    [id, userId],
  );

  if (!result.affectedRows) return null;
  return { id };
}

async function updateById(userId, id, patch) {
  const fields = pickWritableFields(patch);
  const keys = Object.keys(fields);
  if (keys.length === 0) return getById(userId, id);

  const setClause = keys.map((key) => (key === 'type' ? '`type` = ?' : `${key} = ?`)).join(', ');
  const values = keys.map((key) => fields[key]);

  const result = await execute(
    `UPDATE health_records SET ${setClause} WHERE id = ? AND user_id = ?`,
    [...values, id, userId],
  );

  if (!result.affectedRows) return null;
  return getById(userId, id);
}

async function saveInsights(userId, id, insights) {
  const result = await execute(
    `UPDATE health_records
     SET ai_insights = ?, ai_insights_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND user_id = ?`,
    [JSON.stringify(insights), id, userId],
  );

  if (!result.affectedRows) return null;
  return getById(userId, id);
}

module.exports = {
  listByUser,
  create,
  deleteById,
  getById,
  updateById,
  saveInsights,
};
