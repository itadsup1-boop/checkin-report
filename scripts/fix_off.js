import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';

async function run() {
    const dateStr = '2026-08-22T17:00:00.000Z'; // 2026-08-23 locally
    const userIds = [
        'a12c4300-8367-4ee9-b1de-c50961e845ea', // trang
        'daceaee2-d46c-4be9-aa21-f97047f4a4f3'  // Hà trần cẩm nhung
    ];

    for (const userId of userIds) {
        // Update tk_attendance_daily_status to ON_LEAVE
        const statusRes = await pool.query(
            "UPDATE tk_attendance_daily_status SET result = 'ON_LEAVE', updated_at = NOW() WHERE user_id = $1 AND date = '2026-08-22' RETURNING *",
            [userId]
        );
        console.log(`Updated status for user ${userId}:`, statusRes.rows.length);

        // Delete from tk_penalties
        const penRes = await pool.query(
            "DELETE FROM tk_penalties WHERE user_id = $1 AND date >= '2026-08-22' AND violation_type = 'UNAUTHORIZED_ABSENT' RETURNING *",
            [userId]
        );
        console.log(`Deleted penalties for user ${userId}:`, penRes.rows.length);
    }
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
