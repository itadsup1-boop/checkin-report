import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';

async function run() {
    const userId = 'd6139e11-fdb9-4ac8-b7d5-948dc4838d84';
    
    // tk_attendance_daily_status
    const status = await pool.query(
        "SELECT * FROM tk_attendance_daily_status WHERE user_id = $1 AND date >= '2026-08-22'", [userId]
    );
    console.log("Status:", status.rows);

    // tk_penalties
    const pen = await pool.query(
        "SELECT * FROM tk_penalties WHERE user_id = $1 AND date >= '2026-08-22'", [userId]
    );
    console.log("Penalties:", pen.rows);
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
