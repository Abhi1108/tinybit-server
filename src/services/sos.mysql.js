const { query, execute } = require('../config/mysql');

/** Minimal profile fields for SOS trigger logging. */
async function getProfileForTrigger(userId) {
  const rows = await query(
    `SELECT full_name, emergency_name, emergency_phone, mobile
     FROM profiles
     WHERE id = ?
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function createAlert(userId) {
  const { randomUUID } = require('crypto');
  const id = randomUUID();
  await execute(
    `INSERT INTO sos_alerts (id, user_id, triggered_at, status)
     VALUES (?, ?, UTC_TIMESTAMP(3), 'active')`,
    [id, userId],
  );
  return { id };
}

module.exports = {
  getProfileForTrigger,
  createAlert,
};
