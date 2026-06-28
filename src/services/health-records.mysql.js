const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const storageService = require('./storage.service');
const { isStorageConfigured } = require('../config/storage');

const RECORD_SELECT = `
  id, user_id, title, date, timestamp, size, \`type\`, category,
  icon_name, badge_bg, badge_color, uri, mime_type, ai_read, created_at
`;

const WRITABLE_COLUMNS = [
  'title', 'date', 'timestamp', 'size', 'type', 'category',
  'icon_name', 'badge_bg', 'badge_color', 'uri', 'mime_type', 'ai_read',
];

const BOOL_COLUMNS = new Set(['ai_read']);

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRecordRow(row) {
  if (!row) return null;

  return {
    ...row,
    timestamp: row.timestamp == null ? null : Number(row.timestamp),
    ai_read: Boolean(row.ai_read),
    created_at: toIsoString(row.created_at),
  };
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

async function listByUser(userId) {
  const rows = await query(
    `SELECT ${RECORD_SELECT}
     FROM health_records
     WHERE user_id = ?
     ORDER BY timestamp DESC`,
    [userId],
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
      const key = new URL(record.uri).pathname.slice(1);
      const segments = key.split('/');
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

module.exports = {
  listByUser,
  create,
  deleteById,
};
