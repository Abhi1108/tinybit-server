/**
 * Calendar-date ("today"/"this week") helpers. "Today" is per-user, resolved from each
 * user's stored `profiles.timezone` (IANA name) — see `timezone.service.js`'s
 * `resolveTodayForUser`/`getUserTimezone`. Endpoints reachable from a specific client
 * action should prefer a client-supplied date (the phone knows its own local day); the
 * resolver is the fallback/default for server-initiated work with no per-request date
 * channel (alerts scans, AI context, streak bookkeeping on every request, etc).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Last-resort fallback only — for profiles that somehow still have `timezone = NULL`
 *  after the onboarding gate. Not a product assumption that users are in India. */
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Real instant -> calendar-day string in `timezone` (IANA name, e.g. 'America/New_York'). */
function todayForTimezone(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || DEFAULT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Converts a real instant (a `Date`, e.g. `new Date()` or a stored timestamp) to its
 *  calendar-day string in `timezone`. Do NOT use this for pure date-string arithmetic
 *  (see `weekDatesFor`/`addDays` below) — only for "what day is this moment, for this user". */
function dateOnlyForTimezone(date, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || DEFAULT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/** Returns `candidate` if it's a valid YYYY-MM-DD string, else falls back to today in
 *  `DEFAULT_TIMEZONE`. Only used where no specific user is in scope to resolve a real
 *  per-user "today" from — real call sites always pass an explicit candidate. */
function resolveDate(candidate) {
  return typeof candidate === 'string' && DATE_RE.test(candidate) ? candidate : todayForTimezone(DEFAULT_TIMEZONE);
}

/** UTC-minute offset of `timezone` at `atDate` (e.g. +330 for Asia/Kolkata, ahead of UTC).
 *  DST-correct for whatever instant is passed in. */
function offsetMinutesForTimezone(timezone, atDate = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || DEFAULT_TIMEZONE,
    timeZoneName: 'longOffset',
  }).formatToParts(atDate);
  const raw = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  return sign * (hours * 60 + minutes);
}

/**
 * UTC instant range `[start, end]` covering one full local calendar day (`dateStr`,
 * YYYY-MM-DD) in `timezone` — i.e. `[localMidnight, localMidnight + 24h - 1ms]` expressed
 * as real UTC instants. This must be used (not a literal UTC-day range) anywhere a
 * day-bounds query has to match rows written via client-supplied local-day bounds
 * (see `medicine-logs.mysql.js` `listForDay`/`listForWeek`) — otherwise a user whose
 * timezone offset isn't 0 gets a query window shifted away from what their device
 * actually wrote, silently dropping rows near local midnight.
 */
function localDayBoundsForTimezone(dateStr, timezone) {
  const naiveUtcMidnight = new Date(`${dateStr}T00:00:00.000Z`);
  const offsetMin = offsetMinutesForTimezone(timezone, naiveUtcMidnight);
  const start = new Date(naiveUtcMidnight.getTime() - offsetMin * 60000);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

/** UTC instant range covering the Monday-Sunday local week containing `dateStr`, in `timezone`. */
function localWeekBoundsForTimezone(dateStr, timezone) {
  const weekDates = weekDatesFor(dateStr);
  const { start } = localDayBoundsForTimezone(weekDates[0], timezone);
  const { end } = localDayBoundsForTimezone(weekDates[6], timezone);
  return { start, end };
}

/**
 * Pure calendar-string arithmetic: `dateStr` +/- `days`, both YYYY-MM-DD. Anchored to
 * UTC midnight internally purely as a neutral arithmetic base (no "now"/timezone
 * involved) — safe to use freely, unlike `dateOnlyForTimezone` which is specifically for
 * converting a real instant.
 */
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** Monday..Sunday ISO dates (YYYY-MM-DD) for the calendar week containing `dateStr`. */
function weekDatesFor(dateStr) {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay(); // Mon=1..Sun=7
  const monday = addDays(dateStr, -(isoDow - 1));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

module.exports = {
  resolveDate, addDays, weekDatesFor,
  todayForTimezone, dateOnlyForTimezone, DEFAULT_TIMEZONE,
  offsetMinutesForTimezone, localDayBoundsForTimezone, localWeekBoundsForTimezone,
};
