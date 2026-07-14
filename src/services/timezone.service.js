const { query } = require('../config/mysql');
const { todayForTimezone, DEFAULT_TIMEZONE } = require('../utils/date');

/** The stored IANA timezone for `userId`, or `DEFAULT_TIMEZONE` if unset. Single source of
 *  truth for "whose timezone resolves this user's today" — Group 1 call sites pass their
 *  own userId, Group 2 call sites pass the elder's userId, never the guardian's. */
async function getUserTimezone(userId) {
  const rows = await query('SELECT timezone FROM profiles WHERE id = ? LIMIT 1', [userId]);
  return rows[0]?.timezone || DEFAULT_TIMEZONE;
}

async function resolveTodayForUser(userId) {
  return todayForTimezone(await getUserTimezone(userId));
}

module.exports = { getUserTimezone, resolveTodayForUser };
