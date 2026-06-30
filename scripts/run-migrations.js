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
