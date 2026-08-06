/**
 * Dedicated "monitor" app user for the n8n morning health-report bot.
 *
 * The n8n workflow cannot mint Tinybit's signed verificationToken (Firebase phone
 * verification happens on-device), so it authenticates via POST /api/auth/monitor-login
 * with credentials from MONITOR_LOGIN_USERNAME/MONITOR_LOGIN_PASSWORD. That login needs a
 * real app_users row to issue a session against (profiles.id is an FK onto app_users.id),
 * but we deliberately do NOT seed a DB account. Instead the row is created lazily on first
 * successful monitor-login.
 *
 * The monitor user is passwordless: password_hash stays NULL, so verifyPassword() in the
 * normal /api/auth/login always returns false for it — it can only authenticate through
 * monitor-login, whose credentials live in env vars (never in the DB).
 */

const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const { authEmailFromE164 } = require('../utils/phone');
const { findByPhone } = require('./auth-users.service');
const { upsertProfile } = require('./profiles.service');

// Reserved E.164 that cannot collide with a real phone (ITU-T E.164 reserves this range).
const MONITOR_PHONE_E164 = '+00000000000';

async function getOrCreateMonitorUser() {
  const email = authEmailFromE164(MONITOR_PHONE_E164);

  const existing = await findByPhone(MONITOR_PHONE_E164);
  if (existing) {
    // If a previous attempt created the app_users row but the profile is missing (e.g. it was
    // manually deleted), repair it so issueSession callers always have a valid profile.
    await upsertProfile({ id: existing.id, email });
    return existing;
  }

  const id = randomUUID();
  await execute(
    `INSERT INTO app_users (id, phone_e164, email, password_hash)
     VALUES (?, ?, ?, NULL)`,
    [id, MONITOR_PHONE_E164, email],
  );
  await upsertProfile({ id, email });
  return query('SELECT * FROM app_users WHERE id = ? LIMIT 1', [id]).then((rows) => rows[0]);
}

module.exports = { getOrCreateMonitorUser, MONITOR_PHONE_E164 };
