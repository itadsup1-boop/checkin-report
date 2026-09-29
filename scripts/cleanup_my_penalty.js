import 'dotenv/config';
import pool from '../packages/database/index.js';
import { syncAllTimekeepSheets } from '../apps/bot/syncTimekeepSheets.js';

async function main() {
    const penaltyId = '2734d59a-d29c-410d-9211-63a7a5453db0';
    const userId = '7cab5648-0506-45f7-80ee-82a831c27e64';
    const date = '2026-09-27';

    // 1. Delete penalty
    const delPen = await pool.query('DELETE FROM tk_penalties WHERE id = $1 RETURNING *', [penaltyId]);
    console.log('Deleted penalty:', delPen.rows);

    // 2. Remove / reset daily status for today so it doesn't show ABSENT / penalized
    const delStatus = await pool.query('DELETE FROM tk_attendance_daily_status WHERE user_id = $1 AND date = $2 RETURNING *', [userId, date]);
    console.log('Deleted daily status:', delStatus.rows);

    // 3. Resync Google Sheets
    console.log('Resyncing timekeep sheets...');
    await syncAllTimekeepSheets();
    console.log('Sheets synced successfully.');

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
