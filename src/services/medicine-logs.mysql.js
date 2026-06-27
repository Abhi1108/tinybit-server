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

/** Bounds for YYYY-MM-DD calendar date (matches DB unique index on UTC date). */
function calendarDayBounds(dateInput) {
  const normalized = String(dateInput ?? '').trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return {
      start: new Date(`${normalized}T00:00:00.000Z`),
      end: new Date(`${normalized}T23:59:59.999Z`),
    };
  }
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const start = new Date(d);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(d);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function weekBounds(baseDate = new Date()) {
  const d = baseDate instanceof Date ? baseDate : new Date(baseDate);
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
  const { start, end } = calendarDayBounds(date);
  return listInRange(userId, start, end);
}

async function listForWeek(userId, baseDate = new Date()) {
  const { start, end } = weekBounds(baseDate);
  return listInRange(userId, start, end);
}

async function setTakenForDay(userId, medicineId, taken, dateInput = new Date()) {
  const { start, end } = calendarDayBounds(dateInput);

  if (!taken) {
    await execute(
      `DELETE FROM medicine_logs
       WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?`,
      [userId, medicineId, start, end],
    );
    return null;
  }

  const existing = await query(
    `SELECT id, user_id, medicine_id, taken_at, notes, created_at
     FROM medicine_logs
     WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?
     LIMIT 1`,
    [userId, medicineId, start, end],
  );

  if (existing.length > 0) {
    return mapRow(existing[0]);
  }

  const takenAt = new Date();
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
