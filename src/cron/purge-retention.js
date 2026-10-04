const { query } = require('../config/mysql');
const { purgeUserById } = require('../services/user-purge.service');

/**
 * Sweeps users whose account was soft-deleted (self-deleted or admin-trashed)
 * more than 30 days ago and permanently purges their S3 data + cascading DB records.
 */
async function purgeExpiredSoftDeletedUsers() {
  const rows = await query(
    `SELECT id FROM profiles
     WHERE deleted_at IS NOT NULL
       AND deleted_at <= DATE_SUB(NOW(), INTERVAL 30 DAY)`
  );

  if (!rows || rows.length === 0) {
    return { purgedCount: 0, errors: 0 };
  }

  console.log(`[cron:retention] Found ${rows.length} expired trashed user(s) to purge.`);
  let purgedCount = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const result = await purgeUserById(row.id, 'cron:retention', '127.0.0.1');
      if (result.purged) {
        purgedCount += 1;
        console.log(`[cron:retention] Successfully purged user ${row.id}`);
      }
    } catch (err) {
      errors += 1;
      console.error(`[cron:retention] Error purging user ${row.id}:`, err.message);
    }
  }

  return { purgedCount, errors };
}

module.exports = {
  purgeExpiredSoftDeletedUsers,
};
