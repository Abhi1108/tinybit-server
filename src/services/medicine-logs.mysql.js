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
  const medExists = await query(
    `SELECT id FROM medicines WHERE id = ? LIMIT 1`,
    [medicineId],
  );
  if (medExists.length === 0) {
    const err = new Error('Medicine not found or has been deleted.');
    err.statusCode = 404;
    err.code = 'MEDICINE_NOT_FOUND';
    throw err;
  }

  const { start, end } = calendarDayBounds(dateInput);

  if (!taken) {
    const existing = await query(
      `SELECT id FROM medicine_logs
       WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?
       LIMIT 1`,
      [userId, medicineId, start, end],
    );
    if (existing.length > 0) {
      await execute(
        `DELETE FROM medicine_logs
         WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?`,
        [userId, medicineId, start, end],
      );
      // Increment stock
      await execute(
        `UPDATE medicines SET stock = stock + 1 WHERE id = ? AND user_id = ?`,
        [medicineId, userId],
      );
    }
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

  // Decrement stock and get previous stock value
  const beforeMeds = await query(
    `SELECT stock FROM medicines WHERE id = ? AND user_id = ? LIMIT 1`,
    [medicineId, userId],
  );
  const prevStock = beforeMeds[0]?.stock;

  await execute(
    `UPDATE medicines SET stock = GREATEST(0, stock - 1) WHERE id = ? AND user_id = ?`,
    [medicineId, userId],
  );

  const afterMeds = await query(
    `SELECT name, stock FROM medicines WHERE id = ? AND user_id = ? LIMIT 1`,
    [medicineId, userId],
  );
  const med = afterMeds[0];

  if (med && prevStock !== undefined) {
    const stockVal = med.stock;
    if ((prevStock > 0 && stockVal === 0) || (prevStock > 5 && stockVal === 5)) {
      const elders = await query(
        `SELECT full_name FROM profiles WHERE id = ? LIMIT 1`,
        [userId],
      );
      const elderName = elders[0]?.full_name || 'Elder';

      const title = stockVal === 0
        ? `Medicine Exhausted: ${med.name}`
        : `Low Medicine Stock: ${med.name}`;

      const body = stockVal === 0
        ? `Your stock of ${med.name} is completely exhausted. Please replenish it soon.`
        : `Only ${stockVal} doses of ${med.name} remaining. Please replenish your stock soon.`;

      const createNotif = async (targetId, t, b) => {
        const notifId = randomUUID();
        const dataJson = JSON.stringify({ source: 'medicine_stock_alert', medicine_id: medicineId });
        await execute(
          `INSERT INTO notifications (id, user_id, sender_id, type, title, body, data, \`read\`)
           VALUES (?, ?, NULL, 'medicine_alert', ?, ?, ?, 0)`,
          [notifId, targetId, t, b, dataJson],
        );
      };

      // Notify Elder
      await createNotif(userId, title, body);

      // Notify Connected Guardians
      const guardians = await query(
        `SELECT guardian_id FROM guardian_elder_links WHERE elder_id = ? AND status = 'connected'`,
        [userId],
      );

      const guardianBody = stockVal === 0
        ? `Stock of ${med.name} for ${elderName} is completely exhausted. Please replenish it soon.`
        : `Only ${stockVal} doses of ${med.name} left for ${elderName}. Please replenish it soon.`;

      for (const g of guardians) {
        await createNotif(g.guardian_id, title, guardianBody);
      }
    }
  }

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
