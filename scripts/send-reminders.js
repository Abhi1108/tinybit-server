const { query } = require('../src/config/mysql');
const { notifyElder, notifyGuardiansOfElder } = require('../src/services/notifications.service');

// Grace period after a dose's scheduled time before it counts as "missed".
const MISSED_DOSE_GRACE_MS = 30 * 60 * 1000;
// How far ahead to look for upcoming care_events.
const EVENT_LOOKAHEAD_MS = 60 * 60 * 1000;
// Both hour gates are UTC — this backend has no per-user timezone, so times are
// treated as UTC everywhere (same convention as the rest of the codebase, e.g.
// UTC_TIMESTAMP(3) on sos_alerts). ~12:00 UTC / ~04:00 UTC land in the evening /
// morning for the app's primary IST user base.
const CHECKIN_REMINDER_HOUR_UTC = 12;
const HEALTH_NUDGE_HOUR_UTC = 4;
const HEALTH_NUDGE_STALE_DAYS = 30;
const HEALTH_NUDGE_RENOTIFY_DAYS = 7;

function todayUtcStr() {
  return new Date().toISOString().slice(0, 10);
}

function todayUtcMidnight() {
  return new Date(`${todayUtcStr()}T00:00:00.000Z`);
}

/** "8:00 AM" / "2:30 PM" -> minutes since midnight, or null if unparseable. */
function parseTimeToMinutes(timeStr) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr ?? '').trim());
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number(match[2]);
}

/**
 * Has a notification of `type` already been sent to `userId` since `sinceDate`? When
 * `matchKey` is given, only counts rows whose `data[matchKey] === matchValue` (e.g. a
 * specific medicineId/eventId), so multiple distinct reminders of the same type on the
 * same day aren't deduped against each other.
 */
async function alreadyNotified(userId, type, sinceDate, matchKey, matchValue) {
  const rows = await query(
    'SELECT data FROM notifications WHERE user_id = ? AND type = ? AND created_at >= ?',
    [userId, type, sinceDate],
  );
  if (!matchKey) return rows.length > 0;
  return rows.some((r) => {
    const data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return data != null && String(data[matchKey]) === String(matchValue);
  });
}

async function checkMedicineMissed() {
  const todayStr = todayUtcStr();
  const todayWeekday = new Date().getUTCDay();
  const midnight = todayUtcMidnight();

  const medicines = await query(
    `SELECT m.id, m.user_id, m.time, m.days_of_week
     FROM medicines m
     WHERE m.is_active = 1
       AND (m.start_date IS NULL OR m.start_date <= ?)
       AND (m.end_date IS NULL OR m.end_date >= ?)
       AND NOT EXISTS (
         SELECT 1 FROM medicine_logs l WHERE l.medicine_id = m.id AND l.taken_date = ?
       )`,
    [todayStr, todayStr, todayStr],
  );

  let sent = 0;
  const missedCountByElder = {};

  for (const med of medicines) {
    const days = Array.isArray(med.days_of_week)
      ? med.days_of_week
      : JSON.parse(med.days_of_week ?? '[]');
    if (!days.includes(todayWeekday)) continue;

    const minutes = parseTimeToMinutes(med.time);
    if (minutes == null) continue;

    const scheduledMs = midnight.getTime() + minutes * 60 * 1000;
    if (Date.now() < scheduledMs + MISSED_DOSE_GRACE_MS) continue;

    // Counts toward today's aggregate regardless of whether the individual
    // per-dose push below was already sent on an earlier cron tick.
    missedCountByElder[med.user_id] = (missedCountByElder[med.user_id] ?? 0) + 1;

    if (await alreadyNotified(med.user_id, 'medicine_missed', midnight, 'medicineId', med.id)) continue;

    await notifyElder(med.user_id, {
      type: 'medicine_missed',
      title: 'Medicine Missed',
      body: 'It looks like you missed your scheduled medicine. Please take it as soon as possible.',
      data: { type: 'medicine_missed', medicineId: med.id },
    });
    await notifyGuardiansOfElder(med.user_id, {
      type: 'medicine_missed',
      title: 'Medicine Missed',
      body: 'The user missed their scheduled medicine. Please check in with them if needed.',
      data: { type: 'medicine_missed', elderId: med.user_id, medicineId: med.id },
    });
    sent++;
  }
  console.log(`  Medicine Missed: ${sent} notified`);

  // Aggregate: once an elder has 2+ missed doses today, notify guardians once (no
  // elder-side copy — the elder already got each individual "Medicine Missed" push).
  let aggregateSent = 0;
  for (const [elderId, missedCount] of Object.entries(missedCountByElder)) {
    if (missedCount < 2) continue;
    if (await alreadyNotified(elderId, 'missed_medicines_aggregate', midnight)) continue;

    await notifyGuardiansOfElder(elderId, {
      type: 'missed_medicines_aggregate',
      title: 'Missed Medicines',
      body: 'The user has missed multiple scheduled medicines. Please check in with them.',
      data: { type: 'missed_medicines_aggregate', elderId },
    });
    aggregateSent++;
  }
  console.log(`  Missed Medicines (aggregate): ${aggregateSent} notified`);
}

async function checkHealthRecordsNudge() {
  if (new Date().getUTCHours() !== HEALTH_NUDGE_HOUR_UTC) return;

  const staleCutoff = new Date(Date.now() - HEALTH_NUDGE_STALE_DAYS * 24 * 60 * 60 * 1000);
  const elders = await query(
    `SELECT p.id FROM profiles p
     WHERE p.role = 'elder' AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM health_records h WHERE h.user_id = p.id AND h.created_at >= ?
       )`,
    [staleCutoff],
  );

  const renotifyCutoff = new Date(Date.now() - HEALTH_NUDGE_RENOTIFY_DAYS * 24 * 60 * 60 * 1000);
  let sent = 0;
  for (const elder of elders) {
    if (await alreadyNotified(elder.id, 'health_records_nudge', renotifyCutoff)) continue;

    await notifyElder(elder.id, {
      type: 'health_records_nudge',
      title: 'Upload Your Report',
      body: 'Keep your health records up to date by uploading your latest report.',
      data: { type: 'health_records_nudge' },
    });
    await notifyGuardiansOfElder(elder.id, {
      type: 'health_records_nudge',
      title: 'Upload Your Report',
      body: "The user hasn't uploaded their latest health report yet.",
      data: { type: 'health_records_nudge', elderId: elder.id },
    });
    sent++;
  }
  console.log(`  Health Records Nudge: ${sent} notified`);
}

async function checkDailyCheckinReminder() {
  if (new Date().getUTCHours() !== CHECKIN_REMINDER_HOUR_UTC) return;

  const todayStr = todayUtcStr();
  const midnight = todayUtcMidnight();

  const elders = await query(
    `SELECT p.id FROM profiles p
     WHERE p.role = 'elder' AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM daily_checkins c WHERE c.user_id = p.id AND c.check_in_date = ?
       )`,
    [todayStr],
  );

  let sent = 0;
  for (const elder of elders) {
    if (await alreadyNotified(elder.id, 'checkin_reminder', midnight)) continue;

    await notifyElder(elder.id, {
      type: 'checkin_reminder',
      title: 'Daily Check-In',
      body: "Tell us how you're feeling today.",
      data: { type: 'checkin_reminder' },
    });
    await notifyGuardiansOfElder(elder.id, {
      type: 'checkin_reminder',
      title: 'Daily Check-In',
      body: "The user hasn't completed today's daily check-in yet.",
      data: { type: 'checkin_reminder', elderId: elder.id },
    });
    sent++;
  }
  console.log(`  Daily Check-in Reminder: ${sent} notified`);
}

async function checkCalendarEventReminders() {
  const now = Date.now();
  const events = await query(
    'SELECT id, user_id, title FROM care_events WHERE timestamp BETWEEN ? AND ?',
    [now, now + EVENT_LOOKAHEAD_MS],
  );

  const midnight = todayUtcMidnight();
  let sent = 0;
  for (const event of events) {
    if (await alreadyNotified(event.user_id, 'event_reminder', midnight, 'eventId', event.id)) continue;

    await notifyElder(event.user_id, {
      type: 'event_reminder',
      title: event.title,
      body: 'You have an upcoming event scheduled today.',
      data: { type: 'event_reminder', eventId: event.id },
    });
    await notifyGuardiansOfElder(event.user_id, {
      type: 'event_reminder',
      title: event.title,
      body: 'The user has an upcoming event scheduled today.',
      data: { type: 'event_reminder', elderId: event.user_id, eventId: event.id },
    });
    sent++;
  }
  console.log(`  Calendar Event Reminder: ${sent} notified`);
}

async function main() {
  console.log('🔔 Running scheduled reminder checks...');

  for (const check of [
    checkMedicineMissed,
    checkHealthRecordsNudge,
    checkDailyCheckinReminder,
    checkCalendarEventReminders,
  ]) {
    try {
      await check();
    } catch (err) {
      console.error(`  ❌ ${check.name} failed:`, err.message);
    }
  }

  console.log('🎉 Reminder run finished.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Reminder run failed:', err);
    process.exit(1);
  });
