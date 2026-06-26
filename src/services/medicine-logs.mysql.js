const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRow(row) {
  if (!row) return null;
  return {
    ...row,
    taken_at: toIso(row.taken_at),
    created_at: toIso(row.created_at),
  };
}

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function weekBounds(baseDate = new Date()) {
  const d = new Date(baseDate);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() + mondayOffset);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

async function listInRange(userId, from, to) {
  const rows = await query(
    `SELECT id, user_id, medicine_id, taken_at, notes, created_at
     FROM medicine_logs
     WHERE user_id = ? AND taken_at >= ? AND taken_at <= ?
     ORDER BY taken_at ASC`,
    [userId, from, to],
  );
  return rows.map(mapRow);
}

async function listForDay(userId, date = new Date()) {
  const { start, end } = dayBounds(date);
  return listInRange(userId, start, end);
}

async function listForWeek(userId, baseDate = new Date()) {
  const { start, end } = weekBounds(baseDate);
  return listInRange(userId, start, end);
}

async function setTakenForDay(userId, medicineId, taken, date = new Date()) {
  const { start, end } = dayBounds(date);

  if (!taken) {
    await execute(
      `DELETE FROM medicine_logs
       WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?`,
      [userId, medicineId, start, end],
    );
    return { taken: false };
  }

  const existing = await query(
    `SELECT id FROM medicine_logs
     WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?
     LIMIT 1`,
    [userId, medicineId, start, end],
  );

  if (existing.length > 0) {
    return mapRow(existing[0]);
  }

  const takenAt = new Date(date);
  const now = new Date();
  takenAt.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), 0);

  const id = randomUUID();
  await execute(
    `INSERT INTO medicine_logs (id, user_id, medicine_id, taken_at)
     VALUES (?, ?, ?, ?)`,
    [id, userId, medicineId, takenAt],
  );

  const rows = await query(
    `SELECT id, user_id, medicine_id, taken_at, notes, created_at
     FROM medicine_logs WHERE id = ? LIMIT 1`,
    [id],
  );
  return mapRow(rows[0]);
}

module.exports = {
  listForDay,
  listForWeek,
  listInRange,
  setTakenForDay,
};
