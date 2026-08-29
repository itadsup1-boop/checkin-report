import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';

async function run() {
    const userId = 'd6139e11-fdb9-4ac8-b7d5-948dc4838d84';
    
    // 1. Check check-ins for the last 2 days
    const checkins = await pool.query(
        "SELECT * FROM tk_check_ins WHERE user_id = $1 AND date >= '2026-08-22'", [userId]
    );
    console.log("Check-ins:", checkins.rows);

    // 2. Fix the check-in date to '2026-08-23'
    if (checkins.rows.length > 0) {
        await pool.query(
            "UPDATE tk_check_ins SET date = '2026-08-23' WHERE user_id = $1 AND date = '2026-08-22'", [userId]
        );
        console.log("Updated check-in date to 2026-08-23");
    }

    // 3. Fix tk_attendance_daily_status to ON_TIME for 2026-08-23
    await pool.query(
        "UPDATE tk_attendance_daily_status SET result = 'ON_TIME', updated_at = NOW() WHERE user_id = $1 AND date = '2026-08-23'",
        [userId]
    );
    console.log("Updated status to ON_TIME for 2026-08-23");

    // 4. Delete tk_penalties for 2026-08-23
    await pool.query(
        "DELETE FROM tk_penalties WHERE user_id = $1 AND date >= '2026-08-22'",
        [userId]
    );
    console.log("Deleted penalties");
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
