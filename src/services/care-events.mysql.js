const { query } = require('../config/mysql');

const CARE_EVENT_SELECT = `
  id, user_id, title, sub, time, type, color, emoji, date, month, year, timestamp, created_at
`;

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapCareEventRow(row) {
  if (!row) return null;

  return {
    ...row,
    date: row.date == null ? null : Number(row.date),
    year: row.year == null ? null : Number(row.year),
    timestamp: row.timestamp == null ? null : Number(row.timestamp),
    created_at: toIsoString(row.created_at),
  };
}

async function listByUser(userId) {
  const rows = await query(
    `SELECT ${CARE_EVENT_SELECT}
     FROM care_events
     WHERE user_id = ?
     ORDER BY timestamp ASC`,
    [userId],
  );
  return rows.map(mapCareEventRow);
}

module.exports = {
  listByUser,
};
