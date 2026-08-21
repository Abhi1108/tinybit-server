const { query } = require('../config/mysql');
const { todayForTimezone, addDays, DEFAULT_TIMEZONE } = require('../utils/date');

function toDateStr(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

/**
 * Streak stats + enough activity history to render "This Week" (trailing 7
 * calendar days) and "This Month" (1st of the current month through today)
 * without needing month-navigation support.
 */
async function getStreakSummary(userId) {
  const profileRows = await query(
    'SELECT streak, best_streak, timezone FROM profiles WHERE id = ? LIMIT 1',
    [userId],
  );
  const profile = profileRows[0] ?? { streak: 0, best_streak: 0, timezone: null };

  const totalRows = await query(
    'SELECT COUNT(*) AS total FROM streak_activity_log WHERE user_id = ?',
    [userId],
  );
  const totalDays = Number(totalRows[0]?.total ?? 0);

  const today = todayForTimezone(profile.timezone || DEFAULT_TIMEZONE);
  const startOfMonth = `${today.slice(0, 7)}-01`;
  const sevenDaysAgo = addDays(today, -6);
  const rangeStart = startOfMonth < sevenDaysAgo ? startOfMonth : sevenDaysAgo;

  const activityRows = await query(
    `SELECT activity_date FROM streak_activity_log
     WHERE user_id = ? AND activity_date >= ?
     ORDER BY activity_date ASC`,
    [userId, rangeStart],
  );

  const activeDates = activityRows.map((r) => toDateStr(r.activity_date));

  return {
    current: profile.streak || 0,
    best: profile.best_streak || 0,
    totalDays,
    activeDates,
  };
}

module.exports = { getStreakSummary };
