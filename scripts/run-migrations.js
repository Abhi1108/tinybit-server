const { query, execute } = require('../src/config/mysql');

async function runMigrations() {
  console.log('🔄 Running database migrations...');
  try {
    const columns = await query('SHOW COLUMNS FROM doctors');
    const columnNames = new Set(columns.map(c => c.Field));

    const checkAndAdd = async (col, type) => {
      if (!columnNames.has(col)) {
        console.log(`  Adding column "${col}" to doctors table...`);
        await execute(`ALTER TABLE doctors ADD COLUMN ${col} ${type}`);
        console.log(`  ✅ Column "${col}" added successfully.`);
      } else {
        console.log(`  Column "${col}" already exists in doctors table.`);
      }
    };

    await checkAndAdd('hospital', 'VARCHAR(255) NULL');
    await checkAndAdd('phone', 'VARCHAR(32) NULL');
    await checkAndAdd('email', 'VARCHAR(255) NULL');
    await checkAndAdd('about', 'TEXT NULL');

    const profileColumns = await query('SHOW COLUMNS FROM profiles');
    const profileColumnNames = new Set(profileColumns.map(c => c.Field));

    const checkAndAddProfile = async (col, type) => {
      if (!profileColumnNames.has(col)) {
        console.log(`  Adding column "${col}" to profiles table...`);
        await execute(`ALTER TABLE profiles ADD COLUMN ${col} ${type}`);
        console.log(`  ✅ Column "${col}" added successfully.`);
      } else {
        console.log(`  Column "${col}" already exists in profiles table.`);
      }
    };

    await checkAndAddProfile('timezone', 'VARCHAR(64) NULL');

    try {
      const settingsColumns = await query('SHOW COLUMNS FROM user_settings');
      const settingsColumnNames = new Set(settingsColumns.map(c => c.Field));

      const checkAndAddSetting = async (col, type) => {
        if (!settingsColumnNames.has(col)) {
          console.log(`  Adding column "${col}" to user_settings table...`);
          await execute(`ALTER TABLE user_settings ADD COLUMN ${col} ${type}`);
          console.log(`  ✅ Column "${col}" added successfully.`);
        } else {
          console.log(`  Column "${col}" already exists in user_settings table.`);
        }
      };

      await checkAndAddSetting('notify_medicine', 'TINYINT(1) NOT NULL DEFAULT 1');
      await checkAndAddSetting('notify_wellness', 'TINYINT(1) NOT NULL DEFAULT 1');
      await checkAndAddSetting('notify_journal', 'TINYINT(1) NOT NULL DEFAULT 1');
      await checkAndAddSetting('notify_health_reports', 'TINYINT(1) NOT NULL DEFAULT 1');
      await checkAndAddSetting('notify_care_calendar', 'TINYINT(1) NOT NULL DEFAULT 1');
      await checkAndAddSetting('notify_family', 'TINYINT(1) NOT NULL DEFAULT 1');
      await checkAndAddSetting('notify_location', 'TINYINT(1) NOT NULL DEFAULT 1');

      // vibration_alerts was a decorative setting — persisted but never read anywhere to
      // actually control device vibration. Dropped along with its UI toggle.
      if (settingsColumnNames.has('vibration_alerts')) {
        console.log('  Dropping unused column "vibration_alerts" from user_settings table...');
        await execute('ALTER TABLE user_settings DROP COLUMN vibration_alerts');
        console.log('  ✅ Column "vibration_alerts" dropped successfully.');
      } else {
        console.log('  Column "vibration_alerts" already absent from user_settings table.');
      }
    } catch (err) {
      // user_settings isn't created by this script (only by schema.sql on a brand-new database,
      // where it's already defined with these columns) — SHOW COLUMNS failing here just means
      // that table doesn't exist yet on this database, nothing to migrate.
      console.log('  Skipping user_settings column check (table not created yet):', err.message);
    }

    console.log('  Ensuring push_tokens table exists...');
    await execute(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id           CHAR(36)     NOT NULL DEFAULT (UUID()),
        user_id      CHAR(36)     NOT NULL,
        token        VARCHAR(255) NOT NULL,
        platform     ENUM('ios','android','web') NOT NULL,
        device_id    VARCHAR(255) NULL,
        created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        last_seen_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_push_tokens_token (token),
        KEY idx_push_tokens_user (user_id),
        CONSTRAINT fk_push_tokens_user
          FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✅ push_tokens table ready.');

    console.log('  Ensuring cron_notification_log table exists...');
    await execute(`
      CREATE TABLE IF NOT EXISTS cron_notification_log (
        id         CHAR(36)     NOT NULL DEFAULT (UUID()),
        user_id    CHAR(36)     NOT NULL,
        type       VARCHAR(64)  NOT NULL,
        entity_id  VARCHAR(64)  NOT NULL DEFAULT '',
        sent_date  DATE         NOT NULL,
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_cron_notif (user_id, type, entity_id, sent_date),
        CONSTRAINT fk_cron_notif_user
          FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✅ cron_notification_log table ready.');

    console.log('  Ensuring action_notification_log table exists...');
    await execute(`
      CREATE TABLE IF NOT EXISTS action_notification_log (
        id         CHAR(36)     NOT NULL DEFAULT (UUID()),
        user_id    CHAR(36)     NOT NULL,
        type       VARCHAR(64)  NOT NULL,
        entity_id  VARCHAR(64)  NOT NULL DEFAULT '',
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_action_notif (user_id, type, entity_id),
        CONSTRAINT fk_action_notif_user
          FOREIGN KEY (user_id) REFERENCES profiles (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✅ action_notification_log table ready.');

    console.log('  Ensuring push_receipt_tickets table exists...');
    await execute(`
      CREATE TABLE IF NOT EXISTS push_receipt_tickets (
        id         CHAR(36)     NOT NULL DEFAULT (UUID()),
        ticket_id  VARCHAR(64)  NOT NULL,
        token      VARCHAR(255) NOT NULL,
        created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_push_receipt_ticket (ticket_id),
        KEY idx_push_receipt_tickets_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✅ push_receipt_tickets table ready.');

    try {
      console.log('  Updating care_events type check constraint...');
      try {
        await execute('ALTER TABLE care_events DROP CONSTRAINT chk_care_events_type');
      } catch (e) {
        // Ignore if constraint doesn't exist
      }
      await execute(
        "ALTER TABLE care_events ADD CONSTRAINT chk_care_events_type CHECK (`type` IN ('Doctor', 'Family', 'Therapy', 'Activity', 'Medicine', 'Wellness'))"
      );
      console.log('  ✅ Care events check constraint updated successfully.');
    } catch (err) {
      console.warn('  ⚠️ Note: Could not update check constraint:', err.message);
    }

    console.log('🎉 Migrations finished successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

runMigrations();
