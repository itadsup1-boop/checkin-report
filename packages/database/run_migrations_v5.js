import pool from './index.js';
import { cleanInvalidNotificationGroups } from './clean_invalid_notification_groups.js';

async function run() {
    try {
        console.log('Running Migration v5...');

        // 1. Drop FK constraint on tk_schedules.updated_by if exists
        await pool.query(`
            ALTER TABLE tk_schedules 
            DROP CONSTRAINT IF EXISTS tk_schedules_updated_by_fkey;
        `);
        console.log('✅ Dropped constraint tk_schedules_updated_by_fkey (if existed).');

        // 2. Change column updated_by type to VARCHAR(100)
        await pool.query(`
            ALTER TABLE tk_schedules 
            ALTER COLUMN updated_by TYPE VARCHAR(100) 
            USING updated_by::text;
        `);
        console.log('✅ Altered column tk_schedules.updated_by to VARCHAR(100).');

        // 3. Clean invalid schedule_notification_groups mappings
        await cleanInvalidNotificationGroups();

        console.log('Migration v5 completed successfully.');
    } catch (e) {
        console.error('❌ Migration v5 failed:', e.message);
    } finally {
        await pool.end();
    }
}

run();
