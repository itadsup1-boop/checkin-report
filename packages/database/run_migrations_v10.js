import pool from './index.js';

async function run() {
    try {
        console.log('Running Migration v10 (Add Unique Partial Index for tour_makeup_requests)...');

        await pool.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_makeup_dedupe 
            ON tour_makeup_requests(telegram_id, telegram_group_id, work_date, customer_phone) 
            WHERE status IN ('PENDING_NOTIFICATION', 'PENDING', 'APPROVED', 'NOTIFICATION_FAILED');
        `);
        console.log('✅ Unique index idx_tour_makeup_dedupe created.');

        console.log('Migration v10 completed successfully.');
    } finally {
        await pool.end();
    }
}

run().catch((error) => {
    console.error('❌ Migration v10 failed:', error);
    process.exit(1);
});
