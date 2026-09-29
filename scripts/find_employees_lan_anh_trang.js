import 'dotenv/config';
import pool from '../packages/database/index.js';

async function main() {
    const userIds = ['a12c4300-8367-4ee9-b1de-c50961e845ea', 'e8eb3d95-a7b9-4ca5-a8cc-403b3b21cc5c'];
    
    console.log('--- CHECKINS ---');
    const checkins = await pool.query(`SELECT * FROM tk_check_ins WHERE user_id = ANY($1) AND date = '2026-09-25'`, [userIds]);
    console.log(checkins.rows);

    console.log('--- PENALTIES ---');
    const penalties = await pool.query(`SELECT * FROM tk_penalties WHERE user_id = ANY($1) AND date = '2026-09-25'`, [userIds]);
    console.log(penalties.rows);

    console.log('--- DAILY STATUS ---');
    const daily = await pool.query(`SELECT * FROM tk_attendance_daily_status WHERE user_id = ANY($1) AND date = '2026-09-25'`, [userIds]);
    console.log(daily.rows);

    console.log('--- SCHEDULES ---');
    const sched = await pool.query(`SELECT * FROM tk_schedules WHERE user_id = ANY($1) AND date = '2026-09-25'`, [userIds]);
    console.log(sched.rows);

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
