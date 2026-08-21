const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const { getUserTimezone } = require('../services/timezone.service');
const { notifyElder, notifyGuardiansOfElder } = require('../services/notifications.service');
const {
  todayForTimezone,
  localDayBoundsForTimezone,
  hasLocalTimeReached,
  currentTimeForTimezone,
  dateOnlyForTimezone,
} = require('../utils/date');
const SCHEDULE = require('../config/notification-schedule');

/**
 * Atomic claim-then-check-then-send (plan Section 15.1) — the DB unique constraint on
 * `cron_notification_log (user_id, type, entity_id, sent_date)` is what actually prevents a
 * double-send if a tick overlaps a slow previous run, not the `condition()` check by itself
 * (which alone would leave a race). `entityId` disambiguates checks that can fire more than
 * once per day per user (a specific medicine, a specific care event); every other check
 * passes '' and gets a plain once-per-user-per-day dedupe.
 */
async function claimAndNotify({ userId, type, entityId = '', localDate, condition, buildNotification, notifyFn }) {
  if (!(await condition())) return false;

  const result = await execute(
    `INSERT IGNORE INTO cron_notification_log (id, user_id, type, entity_id, sent_date)
     VALUES (?, ?, ?, ?, ?)`,
    [randomUUID(), userId, type, entityId, localDate],
  );
  if (result.affectedRows === 0) return false; // someone already claimed this exact slot

  const { title, body, data } = buildNotification();
  await notifyFn({ type, title, body, data });
  return true;
}

/** "8:00 AM" / "06:30 PM" -> { hour: 0-23, minute }. Mirrors the mobile app's own
 *  `parseTime` in medicine-notifications.ts — same source format, same parsing rules. */
function parseMedicineTime(timeStr) {
  const [timePart, period] = (timeStr ?? '8:00 AM').split(' ');
  const [rawH, rawM] = timePart.split(':').map(Number);
  let hour = rawH ?? 8;
  const minute = rawM ?? 0;
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

function isScheduledOnLocalWeekday(medicine, localWeekday) {
  const days = Array.isArray(medicine.days_of_week) && medicine.days_of_week.length
    ? medicine.days_of_week
    : [0, 1, 2, 3, 4, 5, 6];
  return days.includes(localWeekday);
}

/** 0=Sun..6=Sat for `localDate` (YYYY-MM-DD) — same convention `medicines.days_of_week`
 *  already uses (confirmed against medicine-notifications.ts: `weekday: day + 1` for
 *  expo's 1=Sun..7=Sat scheduling, i.e. day 0 = Sunday). */
function localWeekdayOf(localDate) {
  return new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
}

/** Medicines scheduled for `elderId` today that are still unlogged past their grace window —
 *  the shared condition behind both medicine_missed and missed_medicines_aggregate. */
async function findMissedMedicinesToday(elderId, timezone, localDate) {
  const medicines = await query(
    'SELECT id, name, days_of_week, time FROM medicines WHERE user_id = ? AND is_active = 1',
    [elderId],
  );
  const weekday = localWeekdayOf(localDate);
  const { hour: nowHour, minute: nowMinute } = currentTimeForTimezone(timezone);
  const nowMinutesOfDay = nowHour * 60 + nowMinute;
  const { start, end } = localDayBoundsForTimezone(localDate, timezone);

  const missed = [];
  for (const med of medicines) {
    const days = typeof med.days_of_week === 'string' ? JSON.parse(med.days_of_week) : med.days_of_week;
    if (!isScheduledOnLocalWeekday({ days_of_week: days }, weekday)) continue;

    const { hour, minute } = parseMedicineTime(med.time);
    const scheduledMinutesOfDay = hour * 60 + minute;
    if (nowMinutesOfDay < scheduledMinutesOfDay + SCHEDULE.MEDICINE_MISSED_GRACE_MINUTES) continue;

    const logged = await query(
      'SELECT id FROM medicine_logs WHERE user_id = ? AND medicine_id = ? AND taken_at BETWEEN ? AND ? LIMIT 1',
      [elderId, med.id, start, end],
    );
    if (logged.length === 0) missed.push(med);
  }
  return missed;
}

/** Claims each entity individually (so a medicine missed later in the day still gets its own
 *  timely notification even if a different one was already covered earlier today) but returns
 *  only the ones newly claimed *this call* — the caller combines those into a single message
 *  instead of firing one notification per medicine when several are missed at the same tick. */
async function claimEntities(userId, type, entityIds, localDate) {
  const claimed = [];
  for (const entityId of entityIds) {
    const result = await execute(
      `INSERT IGNORE INTO cron_notification_log (id, user_id, type, entity_id, sent_date)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), userId, type, entityId, localDate],
    );
    if (result.affectedRows > 0) claimed.push(entityId);
  }
  return claimed;
}

/**
 * Combines simultaneously-missed medicines into one notification per recipient instead of one
 * per medicine (confirmed with the user 2026-07-17 — the original per-medicine design, while
 * matching the plan's literal Section 4 table, read as spammy for someone missing several doses
 * at once). Still claims each medicine individually, so a medicine that becomes missed later in
 * the day (a different scheduled time) still gets its own prompt rather than being silently
 * folded into — or suppressed by — an earlier notification that didn't know about it yet.
 */
async function checkMedicineMissed(elder, localDate) {
  const missed = await findMissedMedicinesToday(elder.id, elder.timezone, localDate);
  if (missed.length === 0) return;
  const byId = new Map(missed.map((m) => [m.id, m]));

  const newlyMissedForElder = await claimEntities(elder.id, 'medicine_missed', missed.map((m) => m.id), localDate);
  if (newlyMissedForElder.length > 0) {
    const names = newlyMissedForElder.map((id) => byId.get(id).name);
    const body = names.length === 1
      ? 'It looks like you missed your scheduled medicine. Please take it as soon as possible.'
      : `It looks like you missed ${names.length} scheduled medicines: ${names.join(', ')}. Please take them as soon as possible.`;
    await notifyElder(elder.id, {
      type: 'medicine_missed',
      title: '⚠️ Medicine Missed',
      body,
      data: { type: 'medicine_missed', elderId: elder.id, medicine_ids: newlyMissedForElder },
    });
  }

  // Guardian copy — separate claim type so it can't collide with the elder-facing claim above
  // (both key on the same medicine_id/date otherwise). Uses `missed_medicines_aggregate` as the
  // outgoing notification type specifically when combining 2+, since that's the distinct,
  // already-established type for "more than one missed" from the guardian's point of view;
  // a single newly-missed medicine still sends as a plain `medicine_missed` copy.
  const newlyMissedForGuardian = await claimEntities(elder.id, 'medicine_missed_guardian_copy', missed.map((m) => m.id), localDate);
  if (newlyMissedForGuardian.length > 0) {
    const names = newlyMissedForGuardian.map((id) => byId.get(id).name);
    const combined = names.length > 1;
    const type = combined ? 'missed_medicines_aggregate' : 'medicine_missed';
    const title = combined ? '⚠️ Missed Medicines' : '⚠️ Medicine Missed';
    const body = combined
      ? `The user missed ${names.length} scheduled medicines: ${names.join(', ')}. Please check in with them.`
      : `The user missed their scheduled ${names[0]}. Please check in with them if needed.`;
    await notifyGuardiansOfElder(elder.id, {
      type,
      title,
      body,
      data: { type, elderId: elder.id, medicine_ids: newlyMissedForGuardian },
    });
  }
}

async function checkReportUploadNudge(elder, localDate) {
  const rows = await query('SELECT MAX(created_at) AS last FROM health_records WHERE user_id = ?', [elder.id]);
  const last = rows[0]?.last;
  const daysSince = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
  const overdue = daysSince >= SCHEDULE.REPORT_UPLOAD_NUDGE_DAYS;

  await claimAndNotify({
    userId: elder.id,
    type: 'report_upload_nudge',
    localDate,
    condition: async () => overdue,
    buildNotification: () => ({
      title: '📄 Upload Your Report',
      body: 'Keep your health records up to date by uploading your latest report.',
      data: { type: 'report_upload_nudge', elderId: elder.id },
    }),
    notifyFn: ({ title, body, data }) => notifyElder(elder.id, { type: 'report_upload_nudge', title, body, data }),
  });

  await claimAndNotify({
    userId: elder.id,
    type: 'report_upload_nudge_guardian_copy',
    localDate,
    condition: async () => overdue,
    buildNotification: () => ({
      title: '📄 Upload Your Report',
      body: "The user hasn't uploaded their latest health report yet.",
      data: { type: 'report_upload_nudge', elderId: elder.id },
    }),
    notifyFn: ({ title, body, data }) => notifyGuardiansOfElder(elder.id, { type: 'report_upload_nudge', title, body, data }),
  });
}

async function checkMoodLiftReminder(elder, localDate) {
  const { start, end } = localDayBoundsForTimezone(localDate, elder.timezone);
  await claimAndNotify({
    userId: elder.id,
    type: 'mood_lift_reminder',
    localDate,
    condition: async () => {
      if (!hasLocalTimeReached(elder.timezone, SCHEDULE.MOOD_LIFT_REMINDER_HOUR, SCHEDULE.MOOD_LIFT_REMINDER_MINUTE)) return false;
      // mood_entries rows are only ever inserted for a mood-lift completion specifically
      // (wellness.controller.js), unlike daily_checkins which both mood-lift and the plain
      // check-in share — this is the one reliable "did mood-lift happen today" signal.
      const rows = await query(
        'SELECT id FROM mood_entries WHERE user_id = ? AND created_at BETWEEN ? AND ? LIMIT 1',
        [elder.id, start, end],
      );
      return rows.length === 0;
    },
    buildNotification: () => ({
      title: '🎧 Mood Lift',
      body: 'Take a short activity to refresh your mind today.',
      data: { type: 'mood_lift_reminder', elderId: elder.id },
    }),
    notifyFn: ({ title, body, data }) => notifyElder(elder.id, { type: 'mood_lift_reminder', title, body, data }),
  });
}

async function hasCheckinToday(elderId, localDate) {
  const rows = await query(
    'SELECT id FROM daily_checkins WHERE user_id = ? AND check_in_date = ? LIMIT 1',
    [elderId, localDate],
  );
  return rows.length > 0;
}

async function checkCheckinReminder(elder, localDate) {
  await claimAndNotify({
    userId: elder.id,
    type: 'checkin_reminder',
    localDate,
    condition: async () =>
      hasLocalTimeReached(elder.timezone, SCHEDULE.CHECKIN_REMINDER_HOUR, SCHEDULE.CHECKIN_REMINDER_MINUTE)
      && !(await hasCheckinToday(elder.id, localDate)),
    buildNotification: () => ({
      title: '✅ Daily Check-In',
      body: 'Tell us how you’re feeling today.',
      data: { type: 'checkin_reminder', elderId: elder.id },
    }),
    notifyFn: ({ title, body, data }) => notifyElder(elder.id, { type: 'checkin_reminder', title, body, data }),
  });
}

async function checkCheckinMissed(elder, localDate) {
  await claimAndNotify({
    userId: elder.id,
    type: 'checkin_missed',
    localDate,
    condition: async () =>
      hasLocalTimeReached(elder.timezone, SCHEDULE.CHECKIN_MISSED_HOUR, SCHEDULE.CHECKIN_MISSED_MINUTE)
      && !(await hasCheckinToday(elder.id, localDate)),
    buildNotification: () => ({
      title: '✅ Daily Check-In',
      body: "The user hasn't completed today's daily check-in yet.",
      data: { type: 'checkin_missed', elderId: elder.id },
    }),
    notifyFn: ({ title, body, data }) => notifyGuardiansOfElder(elder.id, { type: 'checkin_missed', title, body, data }),
  });
}

async function checkJournalReminder(elder, localDate, journalType, hour, minute, type, title, body) {
  const { start, end } = localDayBoundsForTimezone(localDate, elder.timezone);
  await claimAndNotify({
    userId: elder.id,
    type,
    localDate,
    condition: async () => {
      if (!hasLocalTimeReached(elder.timezone, hour, minute)) return false;
      const rows = await query(
        'SELECT id FROM journal WHERE user_id = ? AND `type` = ? AND created_at BETWEEN ? AND ? LIMIT 1',
        [elder.id, journalType, start, end],
      );
      return rows.length === 0;
    },
    buildNotification: () => ({ title, body, data: { type, elderId: elder.id } }),
    notifyFn: ({ title: t, body: b, data }) => notifyElder(elder.id, { type, title: t, body: b, data }),
  });
}

async function checkStreakReminder(elder, localDate) {
  await claimAndNotify({
    userId: elder.id,
    type: 'streak_reminder',
    localDate,
    condition: async () => {
      if (!hasLocalTimeReached(elder.timezone, SCHEDULE.STREAK_REMINDER_HOUR, SCHEDULE.STREAK_REMINDER_MINUTE)) return false;
      const rows = await query(
        'SELECT id FROM streak_activity_log WHERE user_id = ? AND activity_date = ? LIMIT 1',
        [elder.id, localDate],
      );
      return rows.length === 0;
    },
    buildNotification: () => ({
      title: '🔥 Keep Your Streak',
      body: 'Complete today’s activity to maintain your streak.',
      data: { type: 'streak_reminder', elderId: elder.id },
    }),
    notifyFn: ({ title, body, data }) => notifyElder(elder.id, { type: 'streak_reminder', title, body, data }),
  });
}

async function checkCareEventReminder(elder, localDate) {
  if (!hasLocalTimeReached(elder.timezone, SCHEDULE.CARE_EVENT_REMINDER_HOUR, SCHEDULE.CARE_EVENT_REMINDER_MINUTE)) return;

  const events = await query('SELECT id, title, timestamp FROM care_events WHERE user_id = ?', [elder.id]);
  const todaysEvents = events.filter((e) => dateOnlyForTimezone(new Date(Number(e.timestamp)), elder.timezone) === localDate);

  for (const event of todaysEvents) {
    await claimAndNotify({
      userId: elder.id,
      type: 'care_event_reminder',
      entityId: event.id,
      localDate,
      condition: async () => true,
      buildNotification: () => ({
        title: `📅 ${event.title}`,
        body: 'The user has an upcoming event scheduled today.',
        data: { type: 'care_event_reminder', elderId: elder.id, care_event_id: event.id },
      }),
      notifyFn: ({ title, body, data }) => notifyGuardiansOfElder(elder.id, { type: 'care_event_reminder', title, body, data }),
    });
  }
}

/** One 15-minute tick: loops per-elder (not one giant cross-elder query), matching the same
 *  per-elder resolution pattern timezone-architecture-plan.md already established. Each
 *  check is independently try/caught so one elder's/one check's failure can't take down the
 *  rest of the tick. */
async function runNotificationChecks() {
  const elders = await query(
    "SELECT id, timezone FROM profiles WHERE role = 'elder' AND deleted_at IS NULL",
  );

  for (const elder of elders) {
    const localDate = todayForTimezone(elder.timezone || await getUserTimezone(elder.id));
    const checks = [
      () => checkMedicineMissed(elder, localDate),
      () => checkReportUploadNudge(elder, localDate),
      () => checkMoodLiftReminder(elder, localDate),
      () => checkCheckinReminder(elder, localDate),
      () => checkCheckinMissed(elder, localDate),
      () => checkJournalReminder(elder, localDate, 'Voice', SCHEDULE.JOURNAL_REMINDER_VOICE_HOUR, SCHEDULE.JOURNAL_REMINDER_VOICE_MINUTE,
        'journal_reminder_voice', '🎙️ Voice Journal', 'Record your thoughts and memories today.'),
      () => checkJournalReminder(elder, localDate, 'Written', SCHEDULE.JOURNAL_REMINDER_WRITTEN_HOUR, SCHEDULE.JOURNAL_REMINDER_WRITTEN_MINUTE,
        'journal_reminder_written', '📔 Memory Journal', "Capture today's memories before they fade."),
      () => checkStreakReminder(elder, localDate),
      () => checkCareEventReminder(elder, localDate),
    ];

    for (const check of checks) {
      try {
        await check();
      } catch (err) {
        console.error(`[cron] notification check failed for elder ${elder.id}:`, err.message);
      }
    }
  }
}

module.exports = {
  runNotificationChecks,
  // Exported for direct testing/verification, not part of the public cron API.
  claimAndNotify,
  parseMedicineTime,
  findMissedMedicinesToday,
  checkMedicineMissed,
};
