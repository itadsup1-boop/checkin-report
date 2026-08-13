import 'dotenv/config';
import pool from '../packages/database/index.js';

const SURCHARGE = 100000;
const REASON_MARKER = ' (Phạt thêm 100k do không có đơn báo trước)';
const apply = process.argv.includes('--apply');

async function loadAffected(client) {
    const result = await client.query(
        `SELECT p.id,
                p.date,
                p.amount,
                p.reason,
                p.user_id,
                p.group_id,
                COALESCE(e.full_name, '') AS full_name,
                COALESCE(g.group_name, '') AS group_name
         FROM tk_penalties p
         LEFT JOIN employees e ON e.id = p.user_id
         LEFT JOIN telegram_groups g ON g.id = p.group_id
         WHERE p.violation_type = 'LATE'
           AND p.reason LIKE $1
         ORDER BY p.date, p.created_at, p.id`,
        [`%${REASON_MARKER}%`]
    );
    return result.rows;
}

async function main() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const before = await loadAffected(client);

        if (!apply) {
            await client.query('ROLLBACK');
            console.log(JSON.stringify({ mode: 'DRY_RUN', count: before.length, rows: before }, null, 2));
            return;
        }

        const updated = await client.query(
            `UPDATE tk_penalties
             SET amount = GREATEST(amount - $1, 0),
                 reason = TRIM(REPLACE(reason, $2, ''))
             WHERE violation_type = 'LATE'
               AND reason LIKE $3
             RETURNING id, date, user_id, group_id, amount, reason`,
            [SURCHARGE, REASON_MARKER, `%${REASON_MARKER}%`]
        );

        await client.query('COMMIT');
        console.log(JSON.stringify({
            mode: 'APPLIED',
            count: updated.rowCount,
            refunded_total: updated.rowCount * SURCHARGE,
            before,
            after: updated.rows
        }, null, 2));
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
