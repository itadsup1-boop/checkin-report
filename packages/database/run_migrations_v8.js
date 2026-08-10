import pool from './index.js';

async function run() {
    try {
        console.log('Running Migration v8 (Add Google Sheet Sync Columns to tour_makeup_requests)...');

        await pool.query(`
            ALTER TABLE tour_makeup_requests 
            ADD COLUMN IF NOT EXISTS sheet_sync_status VARCHAR(50) DEFAULT 'NOT_STARTED',
            ADD COLUMN IF NOT EXISTS sheet_sync_error TEXT;
        `);
        console.log('✅ Columns sheet_sync_status and sheet_sync_error added.');

        console.log('Migration v8 completed successfully.');
    } finally {
        await pool.end();
    }
}

run().catch((error) => {
    console.error('❌ Migration v8 failed:', error);
    process.exit(1);
});
