import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';

async function run() {
    const userId = 'd6139e11-fdb9-4ac8-b7d5-948dc4838d84';
    
    // Check all check-ins for the user
    const checkins = await pool.query(
        "SELECT id, date, check_in_time, video_file_id FROM tk_check_ins WHERE user_id = $1", [userId]
    );
    console.log("Check-ins:", checkins.rows);

    for (const c of checkins.rows) {
        if (c.video_file_id === 'manual_update') {
            await pool.query("UPDATE tk_check_ins SET date = '2026-08-23' WHERE id = $1", [c.id]);
        } else if (c.id === '2f870813-1929-4e0b-adcc-3b34ba3a6ff0') { // The one from 22nd
            await pool.query("UPDATE tk_check_ins SET date = '2026-08-22' WHERE id = $1", [c.id]);
        }
    }
    console.log("Fixed check-in dates.");
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
