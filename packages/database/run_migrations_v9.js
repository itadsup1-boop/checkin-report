import pool from './index.js';

async function run() {
    try {
        console.log('Running Migration v9 (Update tour_makeup_requests status CHECK constraint)...');

        await pool.query(`
            ALTER TABLE tour_makeup_requests 
            DROP CONSTRAINT IF EXISTS tour_makeup_requests_status_check;
        `);
        console.log('Dropped old constraint.');

        await pool.query(`
            ALTER TABLE tour_makeup_requests 
            ADD CONSTRAINT tour_makeup_requests_status_check 
            CHECK (status IN ('PENDING_NOTIFICATION', 'PENDING', 'APPROVED', 'REJECTED', 'NOTIFICATION_FAILED'));
        `);
        console.log('Added new constraint allowing PENDING_NOTIFICATION and NOTIFICATION_FAILED.');

        console.log('Migration v9 completed successfully.');
    } finally {
        await pool.end();
    }
}

run().catch((error) => {
    console.error('❌ Migration v9 failed:', error);
    process.exit(1);
});
