import 'dotenv/config';
import pool from '../packages/database/index.js';

async function fixTodayCheckin() {
    const userId = '05445686-06dc-4c68-8d48-a35cda327e71';
    const date = '2026-09-27';

    // 1. Update tk_check_ins
    const updateCheckin = await pool.query(
        `UPDATE tk_check_ins 
         SET checkin_penalty_amount = 0, work_credit = 1.0
         WHERE user_id = $1 AND date = $2
         RETURNING *`,
        [userId, date]
    );
    console.log('Updated tk_check_ins:', updateCheckin.rows);

    // 2. Delete late penalty
    const deletePenalty = await pool.query(
        `DELETE FROM tk_penalties
         WHERE user_id = $1 AND date = $2 AND violation_type = 'LATE'
         RETURNING *`,
        [userId, date]
    );
    console.log('Deleted tk_penalties:', deletePenalty.rows);

    await pool.end();
}

fixTodayCheckin().catch(err => {
    console.error(err);
    process.exit(1);
});
