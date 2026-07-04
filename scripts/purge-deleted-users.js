const { query } = require('../src/config/mysql');
const { purgeUserById } = require('../src/services/user-purge.service');

const GRACE_DAYS = parseInt(process.env.USER_PURGE_GRACE_DAYS || '30', 10);

async function main() {
  console.log(`🔎 Looking for users past their ${GRACE_DAYS}-day trash grace period...`);

  const rows = await query(
    `SELECT id FROM profiles
     WHERE deleted_at IS NOT NULL
       AND deleted_at <= NOW() - INTERVAL ? DAY`,
    [GRACE_DAYS],
  );

  console.log(`Found ${rows.length} user(s) to purge.`);

  for (const row of rows) {
    try {
      const result = await purgeUserById(row.id, 'system:cron');
      if (!result.purged) {
        console.log(`  Skipped ${row.id} (${result.reason})`);
        continue;
      }
      const failureNote = result.s3Failures.length ? `, ${result.s3Failures.length} S3 failure(s)` : '';
      console.log(`  ✅ Purged ${row.id} (${result.deletedObjectCount} S3 object(s) removed${failureNote})`);
    } catch (err) {
      console.error(`  ❌ Failed to purge ${row.id}:`, err.message);
    }
  }

  console.log('🎉 Purge run finished.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Purge run failed:', err);
    process.exit(1);
  });
