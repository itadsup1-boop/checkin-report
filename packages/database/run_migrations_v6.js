import pool from './index.js';

async function run() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tk_attendance_daily_status (
                group_id UUID NOT NULL REFERENCES telegram_groups(id) ON DELETE CASCADE,
                user_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
                date DATE NOT NULL,
                result VARCHAR(30),
                reminder_sent_at TIMESTAMP WITH TIME ZONE,
                late_warning_sent_at TIMESTAMP WITH TIME ZONE,
                finalized_at TIMESTAMP WITH TIME ZONE,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                PRIMARY KEY (group_id, user_id, date)
            )
        `);
        console.log('Migration v6 completed: tk_attendance_daily_status is ready.');
    } finally {
        await pool.end();
    }
}

run().catch((error) => {
    console.error('Migration v6 failed:', error);
    process.exit(1);
});
