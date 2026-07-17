const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const { resolveTodayForUser, getUserTimezone } = require('./timezone.service');
const { localDayBoundsForTimezone, localWeekBoundsForTimezone, dateOnlyForTimezone } = require('../utils/date');
const { notifyElder, notifyGuardiansOfElder } = require('./notifications.service');

function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * `taken_date_local` is the calendar date `taken_at` falls on in `timezone` — needed
 * because clients (e.g. the guardian app's medicine-history screen) must not derive "which
 * day was this dose taken" by slicing the UTC `taken_at` string themselves; that silently
 * reproduces the same UTC-vs-local-day bug already fixed server-side (see
 * `localDayBoundsForTimezone`). The server is the only place that knows the elder's
 * timezone, so it must hand back the already-correct bucket.
 */
function mapRow(row, timezone) {
  if (!row) return null;
  return {
    ...row,
    taken_at: toIso(row.taken_at),
    created_at: toIso(row.created_at),
    taken_date_local: row.taken_at != null
      ? dateOnlyForTimezone(row.taken_at instanceof Date ? row.taken_at : new Date(row.taken_at), timezone)
      : null,
  };
}

async function listInRange(userId, from, to, timezone) {
  const tz = timezone ?? await getUserTimezone(userId);
  const rows = await query(
    `SELECT id, user_id, medicine_id, taken_at, notes, created_at
     FROM medicine_logs
     WHERE user_id = ? AND taken_at >= ? AND taken_at <= ?
     ORDER BY taken_at ASC`,
    [userId, from, to],
  );
  return rows.map((row) => mapRow(row, tz));
}

/**
 * `date`/`baseDate`, when passed, must already be a YYYY-MM-DD string in `userId`'s own
 * local calendar (e.g. from `resolveTodayForUser`/`addDays`) — bounds are always computed
 * in `userId`'s stored timezone, whether `userId` is the caller (Group 1) or an elder being
 * viewed by their guardian (Group 2, where `userId` here is the elder's id, never the
 * guardian's). Using a literal-UTC day window here would silently miss rows written near
 * local midnight by a client in any timezone other than UTC+0.
 */
async function listForDay(userId, date) {
  const timezone = await getUserTimezone(userId);
  const dateStr = date ?? await resolveTodayForUser(userId);
  const { start, end } = localDayBoundsForTimezone(dateStr, timezone);
  return listInRange(userId, start, end, timezone);
}

async function listForWeek(userId, baseDate) {
  const timezone = await getUserTimezone(userId);
  const dateStr = baseDate ?? await resolveTodayForUser(userId);
  const { start, end } = localWeekBoundsForTimezone(dateStr, timezone);
  return listInRange(userId, start, end, timezone);
}

/**
 * `dayBounds` are absolute UTC instants marking the start/end of the caller's
 * *local* calendar day (e.g. computed on-device as `[localMidnight, localMidnight+24h-1ms]`
 * then sent as ISO strings). We deliberately do NOT derive "today" from a fixed
 * server-side offset (e.g. IST) — the whole point is that only the client knows
 * its own local day, which is required for a user base spanning timezones. Falls
 * back to the server's own UTC calendar day only when no client bounds are given
 * (defensive default; real callers always pass explicit bounds).
 */
function defaultDayBounds() {
  const now = new Date();
  const start = new Date(now); start.setUTCHours(0, 0, 0, 0);
  const end = new Date(now); end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

async function setTakenForDay(userId, medicineId, taken, dayBounds) {
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

  const { start, end } = dayBounds ?? defaultDayBounds();
  const timezone = await getUserTimezone(userId);

  if (!taken) {
    const existing = await query(
      `SELECT id FROM medicine_logs
       WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?
       LIMIT 1`,
      [userId, medicineId, start, end],
    );
    if (existing.length === 0) {
      // Nothing to undo — same "no genuinely new event" reasoning as `alreadyLogged` below,
      // just for the opposite direction. The controller uses this to skip notifying guardians
      // of a reversal that didn't actually happen (e.g. a repeat toggle/retry).
      return null;
    }

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
    return { reverted: true };
  }

  const existing = await query(
    `SELECT id, user_id, medicine_id, taken_at, notes, created_at
     FROM medicine_logs
     WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?
     LIMIT 1`,
    [userId, medicineId, start, end],
  );

  if (existing.length > 0) {
    // Already logged — not a new dose-taking event, so the caller must not re-fire
    // medicine_dose_completed for it (that was the actual bug: a repeat toggle/retry
    // returned this same row shape as a fresh log, so the controller couldn't tell them apart).
    return { ...mapRow(existing[0], timezone), alreadyLogged: true };
  }

  const takenAt = new Date();
  const id = randomUUID();
  try {
    await execute(
      `INSERT INTO medicine_logs (id, user_id, medicine_id, taken_at)
       VALUES (?, ?, ?, ?)`,
      [id, userId, medicineId, takenAt],
    );
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      // Two things can cause the unique index (user_id, medicine_id, taken_date —
      // taken_date being a raw UTC calendar date) to reject this insert:
      //  1. A genuine concurrent toggle (e.g. a rapid double-tap) won the race
      //     between the existence check above and this insert. Its row *does*
      //     fall inside the caller's local-day bounds — return it as the
      //     idempotent result instead of a 500 (and skip redoing the stock
      //     decrement/notifications the winner already handled).
      //  2. Near the user's local midnight, "today" and "yesterday" can share
      //     the same UTC calendar date even though they're different local
      //     days (taken_date is UTC-only; it doesn't know the caller's local
      //     day). In that case there's no row inside our bounds — the collision
      //     is with an unrelated adjacent day's dose, not a duplicate of this
      //     one. Silently returning success here would tell the client a dose
      //     was logged when it wasn't, so surface a clear, honest error instead.
      const rows = await query(
        `SELECT id, user_id, medicine_id, taken_at, notes, created_at
         FROM medicine_logs
         WHERE user_id = ? AND medicine_id = ? AND taken_at >= ? AND taken_at <= ?
         LIMIT 1`,
        [userId, medicineId, start, end],
      );
      if (rows.length > 0) {
        // Same reasoning as the early-return above — a concurrent request already logged
        // this dose (and already handled the stock decrement/notification).
        return { ...mapRow(rows[0], timezone), alreadyLogged: true };
      }
      const conflictErr = new Error(
        'Could not log this dose because it falls right at your local midnight boundary. Please try again in a few minutes.',
      );
      conflictErr.statusCode = 409;
      conflictErr.code = 'DAY_BOUNDARY_CONFLICT';
      throw conflictErr;
    }
    throw err;
  }

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

      // Routed through the same notifyElder/notifyGuardiansOfElder helpers every other
      // notification type uses — previously this wrote inbox rows via a raw INSERT with no
      // push and a `data` shape (`{ source, medicine_id }`) inconsistent with every other type
      // (no `type`/`elderId`), so it never actually reached anyone unless they happened to open
      // the in-app inbox.
      const data = { type: 'medicine_alert', elderId: userId, medicine_id: medicineId };

      await notifyElder(userId, { type: 'medicine_alert', title, body, data });

      const guardianBody = stockVal === 0
        ? `Stock of ${med.name} for ${elderName} is completely exhausted. Please replenish it soon.`
        : `Only ${stockVal} doses of ${med.name} left for ${elderName}. Please replenish it soon.`;

      await notifyGuardiansOfElder(userId, { type: 'medicine_alert', title, body: guardianBody, data });
    }
  }

  const rows = await query(
    `SELECT id, user_id, medicine_id, taken_at, notes, created_at
     FROM medicine_logs WHERE id = ? LIMIT 1`,
    [id],
  );
  return { ...mapRow(rows[0], timezone), alreadyLogged: false };
}

module.exports = {
  listForDay,
  listForWeek,
  listInRange,
  setTakenForDay,
};
