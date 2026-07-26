import pool from './index.js';

async function run() {
    try {
        console.log('Running Migration v6...');

        // 1. Add session_type column to customer_appointments
        await pool.query(`
            ALTER TABLE customer_appointments 
            ADD COLUMN IF NOT EXISTS session_type VARCHAR(50) DEFAULT 'Bán';
        `);
        console.log('✅ Added column customer_appointments.session_type.');

        // 2. Add today_incurred column to customer_appointments
        await pool.query(`
            ALTER TABLE customer_appointments 
            ADD COLUMN IF NOT EXISTS today_incurred TEXT;
        `);
        console.log('✅ Added column customer_appointments.today_incurred.');

        console.log('Migration v6 completed successfully.');
    } catch (e) {
        console.error('❌ Migration v6 failed:', e.message);
    } finally {
        await pool.end();
    }
}

run();
