/**
 * Central timing configuration for every cron-based notification check (plan doc Section 4/15).
 * Change a reminder time or window here — nowhere else in the codebase should hardcode one.
 * All hour/minute values are in the elder's own local time (see timezone.service.js,
 * resolveTodayForUser) — cron checks must resolve local time before comparing against these.
 * Confirmed with the client 2026-07-17: fixed for every user, not user-configurable.
 */

module.exports = {
  // medicine_missed: grace period after a dose's scheduled time before it counts as missed.
  MEDICINE_MISSED_GRACE_MINUTES: 60,

  // mood_lift_reminder
  MOOD_LIFT_REMINDER_HOUR:   16, // 4:00 PM
  MOOD_LIFT_REMINDER_MINUTE: 0,

  // checkin_reminder
  CHECKIN_REMINDER_HOUR:   19, // 7:00 PM
  CHECKIN_REMINDER_MINUTE: 0,

  // checkin_missed (guardian copy) — must stay later than CHECKIN_REMINDER_HOUR/MINUTE above.
  CHECKIN_MISSED_HOUR:   21, // 9:00 PM
  CHECKIN_MISSED_MINUTE: 0,

  // journal_reminder (voice) — staggered from the written reminder below so they don't fire
  // at the exact same tick.
  JOURNAL_REMINDER_VOICE_HOUR:   18, // 6:00 PM
  JOURNAL_REMINDER_VOICE_MINUTE: 0,

  // journal_reminder (written)
  JOURNAL_REMINDER_WRITTEN_HOUR:   18, // 6:30 PM
  JOURNAL_REMINDER_WRITTEN_MINUTE: 30,

  // streak_reminder
  STREAK_REMINDER_HOUR:   20, // 8:00 PM
  STREAK_REMINDER_MINUTE: 0,

  // care_event_reminder (guardian copy) — one morning digest job, not per-event.
  CARE_EVENT_REMINDER_HOUR:   8, // 8:00 AM
  CARE_EVENT_REMINDER_MINUTE: 0,

  // report_upload_nudge — nudge if no health_records upload in this many days.
  REPORT_UPLOAD_NUDGE_DAYS: 30,
};
