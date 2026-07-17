const { randomUUID } = require('crypto');
const { Expo } = require('expo-server-sdk');
const { query, execute } = require('../config/mysql');
const guardianService = require('./guardian.service');

const expo = new Expo();

/** mysql2 returns JSON columns as raw strings — parse, tolerating already-parsed values. */
function parseDataColumn(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapNotificationRow(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: parseDataColumn(row.data),
    read: !!row.read,
    senderName: row.sender_name ?? null,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

/**
 * Race-safe debounce for action-triggered notifications (plan Section 17.3) — suppresses a
 * repeat of the same (userId, type, entityId) within `windowSeconds`, so a double-tap or an
 * at-least-once network retry can't send the same "medicine added"/"SOS"/etc. notification
 * twice, while a genuinely separate action taken later (even a minute later) still sends
 * normally. Default window is a conservative 10s — long enough to absorb a retry/double-tap,
 * short enough that two real, distinct actions taken in quick succession (e.g. adding two
 * different medicines back-to-back) don't get incorrectly collapsed into one.
 *
 * Two-step, not a single `INSERT ... ON DUPLICATE KEY UPDATE`: that idiom's `affectedRows` is
 * unreliable here — verified empirically that mysql2 reports `affectedRows: 1` even when the
 * `ON DUPLICATE KEY UPDATE` clause is a no-op self-assignment (`CLIENT_FOUND_ROWS`-style
 * semantics), so it can't distinguish "won the claim" from "already claimed". A plain `UPDATE
 * ... WHERE created_at < window` has no such ambiguity — if the row is outside the window the
 * WHERE clause simply never matches it, so `affectedRows` is unambiguously 0. Still fully
 * race-safe: MySQL's row-level locking serializes concurrent attempts on either step, and each
 * step's WHERE/unique-key condition is re-evaluated against whatever the winner just committed.
 */
async function shouldSendActionNotification(userId, type, entityId = '', windowSeconds = 10) {
  const inserted = await execute(
    `INSERT IGNORE INTO action_notification_log (id, user_id, type, entity_id, created_at)
     VALUES (?, ?, ?, ?, NOW(3))`,
    [randomUUID(), userId, type, entityId],
  );
  if (inserted.affectedRows > 0) return true; // genuinely new claim, no prior row existed

  const refreshed = await execute(
    `UPDATE action_notification_log
     SET created_at = NOW(3)
     WHERE user_id = ? AND type = ? AND entity_id = ? AND created_at < NOW(3) - INTERVAL ? SECOND`,
    [userId, type, entityId, windowSeconds],
  );
  return refreshed.affectedRows > 0; // true only if the existing claim was actually stale
}

/**
 * Maps every notification `type` string to the `user_settings` boolean column that gates its
 * *push* delivery (Reminders & Alerts settings screen) — grouped by topic, not by raw type, so
 * the settings screen shows ~7 switches instead of ~25. Types not listed here (and both
 * `ALWAYS_ON_NOTIFICATION_TYPES` below) always send regardless of any preference row.
 */
const NOTIFICATION_TYPE_CATEGORY = {
  medicine_added: 'notify_medicine',
  medicine_updated: 'notify_medicine',
  medicine_removed: 'notify_medicine',
  medicine_alert: 'notify_medicine',
  medicine_missed: 'notify_medicine',
  missed_medicines_aggregate: 'notify_medicine',
  medicine_dose_completed: 'notify_medicine',

  checkin_reminder: 'notify_wellness',
  checkin_missed: 'notify_wellness',
  daily_checkin: 'notify_wellness',
  mood_lift_reminder: 'notify_wellness',
  mood_lift_completed: 'notify_wellness',
  streak_reminder: 'notify_wellness',
  streak_maintained: 'notify_wellness',

  journal_reminder_voice: 'notify_journal',
  journal_reminder_written: 'notify_journal',
  journal_added: 'notify_journal',

  report_upload_nudge: 'notify_health_reports',
  report_uploaded: 'notify_health_reports',

  care_event_reminder: 'notify_care_calendar',

  guardian_invite: 'notify_family',
  emergency_contact_updated: 'notify_family',
  guardian_alert_notify: 'notify_family',

  location_update: 'notify_location',
};

/** Safety-critical types that are never suppressible from the settings screen — an elder or
 * guardian can't accidentally (or deliberately) silence an SOS or an urgent family reminder. */
const ALWAYS_ON_NOTIFICATION_TYPES = new Set(['sos_alert', 'guardian_reminder']);

/**
 * Whether `userId` should receive a *push* for `type` right now — checked once per recipient
 * per send (not per device token, since the preference is per-user). The in-app inbox row is
 * never gated by this; only the push is. Defaults to `true` when there's no settings row yet
 * (new users, or a category added after this user's row was created) so behavior matches the
 * pre-preferences era unless someone explicitly opts out.
 */
async function isPushEnabledForType(userId, type) {
  if (ALWAYS_ON_NOTIFICATION_TYPES.has(type)) return true;

  const category = NOTIFICATION_TYPE_CATEGORY[type];
  if (!category) return true;

  const rows = await query(
    `SELECT ${category} FROM user_settings WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  const value = rows[0]?.[category];
  return value == null ? true : Boolean(value);
}

/** Inserts one row into the in-app notifications inbox. */
async function createNotification({ userId, senderId = null, type, title, body, data = null }) {
  const id = randomUUID();
  await execute(
    `INSERT INTO notifications (id, user_id, sender_id, type, title, body, data, \`read\`)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [id, userId, senderId, type, title, body, data ? JSON.stringify(data) : null],
  );
  return id;
}

/** Deletes a token that Expo has confirmed is dead (app uninstalled, OS revoked it) — plan
 * Section 10 point 4 / 13.5. Matches on the raw token string, not a specific user, since by the
 * time a receipt comes back the token may already belong to someone else (Phase 2's reassign-
 * on-relogin design) or be gone entirely; either way there's nothing left to prune. */
async function pruneDeadToken(token) {
  await execute('DELETE FROM push_tokens WHERE token = ?', [token]);
}

/** Records a successful send's receipt id for later checking — Expo doesn't know the actual
 * delivery outcome (including DeviceNotRegistered) until some time after the ticket is issued. */
async function recordPushTicket(token, ticket) {
  if (!ticket) return;
  if (ticket.status === 'error') {
    // Occasionally Expo can tell immediately (a malformed/already-known-dead token) rather than
    // only via the later receipt — no reason to wait for a receipt that won't add information.
    if (ticket.details?.error === 'DeviceNotRegistered') {
      await pruneDeadToken(token);
    } else {
      console.warn('[notifications] Expo push ticket error:', ticket.message);
    }
    return;
  }
  await execute(
    'INSERT IGNORE INTO push_receipt_tickets (id, ticket_id, token) VALUES (?, ?, ?)',
    [randomUUID(), ticket.id, token],
  );
}

/** Sends a push notification via Expo's push API. Failures are swallowed — push is best-effort.
 * Uses the official expo-server-sdk (not a raw fetch) for correctly-typed ticket/error parsing,
 * and records the returned ticket so checkPushReceipts can later prune the token if Expo
 * reports it as dead. */
async function sendExpoPush(token, { title, body, data = null }) {
  if (!token) return;
  if (!Expo.isExpoPushToken(token)) {
    console.warn('[notifications] Not a valid Expo push token, skipping:', token);
    return;
  }
  try {
    const [ticket] = await expo.sendPushNotificationsAsync([{
      to: token,
      title,
      body,
      data: data ?? undefined,
      sound: 'default',
    }]);
    await recordPushTicket(token, ticket);
  } catch (err) {
    console.warn('[notifications] Expo push failed:', err.message);
  }
}

/**
 * Checks pending receipt tickets and prunes any token Expo reports as DeviceNotRegistered
 * (plan Section 10 point 4 / 13.5) — without this, a dead token (app uninstalled, OS revoked
 * it) accumulates forever and every future send wastes a call on it. Meant to be called
 * periodically from the cron scheduler, not per-request.
 */
async function checkPushReceipts() {
  // Expo recommends waiting before receipts are available; also caps how many tickets one
  // getPushNotificationReceiptsAsync call can request (pushNotificationReceiptChunkSizeLimit).
  const pending = await query(
    `SELECT ticket_id, token FROM push_receipt_tickets
     WHERE created_at < NOW() - INTERVAL 15 MINUTE
     LIMIT ${Expo.pushNotificationReceiptChunkSizeLimit}`,
  );
  if (pending.length === 0) return;

  let receipts;
  try {
    receipts = await expo.getPushNotificationReceiptsAsync(pending.map((p) => p.ticket_id));
  } catch (err) {
    console.warn('[notifications] getPushNotificationReceiptsAsync failed:', err.message);
    return;
  }

  for (const { ticket_id: ticketId, token } of pending) {
    const receipt = receipts[ticketId];
    // Not ready yet — leave the ticket row in place, checked again on a later tick. The
    // safety-net cleanup below still bounds how long an unresolved ticket can linger.
    if (!receipt) continue;

    if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
      await pruneDeadToken(token);
    }
    await execute('DELETE FROM push_receipt_tickets WHERE ticket_id = ?', [ticketId]);
  }

  // Safety net: Expo only keeps receipts available for about a day — a ticket that never
  // resolves (network issue, Expo-side hiccup) shouldn't accumulate forever.
  await execute('DELETE FROM push_receipt_tickets WHERE created_at < NOW() - INTERVAL 2 DAY');
}

/**
 * Notifies every guardian connected to an elder — one in-app notification row plus a
 * best-effort push to every device that guardian has registered a token from.
 */
async function notifyGuardiansOfElder(elderId, { type, title, body, data = null }) {
  const guardians = await guardianService.getConnectedGuardians(elderId);

  for (const guardian of guardians) {
    await createNotification({
      userId: guardian.id,
      senderId: elderId,
      type,
      title,
      body,
      data,
    });
    if (await isPushEnabledForType(guardian.id, type)) {
      await Promise.allSettled(
        (guardian.push_tokens ?? []).map((token) => sendExpoPush(token, { title, body, data })),
      );
    }
  }

  return guardians.length;
}

/**
 * Notifies a single elder — one in-app notification row plus a best-effort push to every
 * device the elder has registered, for guardian-initiated changes to the elder's own data.
 * Mirrors notifyGuardiansOfElder.
 */
async function notifyElder(elderId, { senderId = null, type, title, body, data = null }) {
  const tokens = await guardianService.getElderPushTokens(elderId);

  await createNotification({
    userId: elderId,
    senderId,
    type,
    title,
    body,
    data,
  });
  if (await isPushEnabledForType(elderId, type)) {
    await Promise.allSettled(tokens.map((token) => sendExpoPush(token, { title, body, data })));
  }
}

/**
 * Paginated inbox listing for a user, newest first, plus their current unread count.
 * `limit`/`offset` are inlined as validated integers rather than passed as `?` placeholders —
 * `LIMIT ?`/`OFFSET ?` bound params are a known mysql2 inconsistency across versions (see the
 * identical note in family-messages.mysql.js); safe here since both are clamped below, never
 * raw user input.
 */
async function listNotifications(userId, { limit = 20, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

  const rows = await query(
    `SELECT n.id, n.type, n.title, n.body, n.data, n.\`read\`, n.created_at,
            p.full_name AS sender_name
     FROM notifications n
     LEFT JOIN profiles p ON p.id = n.sender_id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC
     LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    [userId],
  );

  const [{ total }] = await query(
    'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ?',
    [userId],
  );
  const [{ unread }] = await query(
    'SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND `read` = 0',
    [userId],
  );

  return {
    notifications: rows.map(mapNotificationRow),
    total,
    unread,
  };
}

/** Marks one notification read — scoped to the caller's own rows, so a user can't mark (or
 * even discover the existence of) another user's notification by guessing an id. */
async function markNotificationRead(id, userId) {
  const result = await execute(
    'UPDATE notifications SET `read` = 1 WHERE id = ? AND user_id = ?',
    [id, userId],
  );
  return result.affectedRows > 0;
}

module.exports = {
  createNotification,
  sendExpoPush,
  notifyGuardiansOfElder,
  notifyElder,
  listNotifications,
  markNotificationRead,
  shouldSendActionNotification,
  checkPushReceipts,
  isPushEnabledForType,
};
