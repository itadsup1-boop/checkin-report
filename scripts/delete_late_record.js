import pool from '../packages/database/index.js';

function readArg(name) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : null;
}

const fullName = readArg('name')?.trim();
const date = readArg('date')?.trim();
const telegramGroupId = readArg('group')?.trim() || null;
const confirmed = process.argv.includes('--confirm');

if (!fullName || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    console.error('Cách dùng: node scripts/delete_late_record.js --name "Tên nhân viên" --date YYYY-MM-DD [--group TELEGRAM_GROUP_ID] [--confirm]');
    process.exit(1);
}

const client = await pool.connect();

try {
    const matches = await client.query(`
        SELECT DISTINCT
            e.id AS employee_id,
            e.full_name,
            e.telegram_group_id,
            g.id AS group_id,
            g.group_name,
            p.id AS penalty_id,
            p.date::text,
            p.late_minutes,
            p.amount,
            p.reason,
            ds.result
        FROM employees e
        JOIN telegram_groups g ON g.id = e.group_id
        LEFT JOIN tk_penalties p
          ON p.user_id = e.id
         AND p.group_id = g.id
         AND p.date = $2
         AND p.violation_type = 'LATE'
        LEFT JOIN tk_attendance_daily_status ds
          ON ds.user_id = e.id
         AND ds.group_id = g.id
         AND ds.date = $2
         AND ds.result IN ('LATE', 'LATE_NOTIFIED')
        WHERE LOWER(TRIM(e.full_name)) = LOWER(TRIM($1))
          AND ($3::text IS NULL OR e.telegram_group_id = $3)
          AND (p.id IS NOT NULL OR ds.user_id IS NOT NULL)
        ORDER BY g.group_name
    `, [fullName, date, telegramGroupId]);

    if (matches.rows.length === 0) {
        console.log('Không tìm thấy dữ liệu đi muộn phù hợp. Không có gì bị xóa.');
        process.exitCode = 2;
    } else if (matches.rows.length > 1 && !telegramGroupId) {
        console.table(matches.rows);
        console.error('Tìm thấy nhiều nhóm. Hãy chạy lại với --group TELEGRAM_GROUP_ID để tránh xóa nhầm.');
        process.exitCode = 3;
    } else if (!confirmed) {
        console.table(matches.rows);
        console.log('Đây là chế độ xem trước. Thêm --confirm để thực sự xóa.');
    } else {
        const target = matches.rows[0];
        await client.query('BEGIN');

        const penaltyDelete = await client.query(`
            DELETE FROM tk_penalties
            WHERE group_id = $1 AND user_id = $2 AND date = $3 AND violation_type = 'LATE'
        `, [target.group_id, target.employee_id, date]);

        const statusUpdate = await client.query(`
            INSERT INTO tk_attendance_daily_status
                (group_id, user_id, date, result, finalized_at, updated_at)
            VALUES ($1, $2, $3, 'ON_TIME', NOW(), NOW())
            ON CONFLICT (group_id, user_id, date) DO UPDATE SET
                result = 'ON_TIME',
                finalized_at = NOW(),
                updated_at = NOW()
        `, [target.group_id, target.employee_id, date]);

        await client.query('COMMIT');
        console.log(`Đã xóa dữ liệu đi muộn của ${target.full_name} ngày ${date} tại nhóm ${target.group_name}.`);
        console.log(`tk_penalties đã xóa: ${penaltyDelete.rowCount}; trạng thái ngày đã chốt ON_TIME: ${statusUpdate.rowCount}`);
    }
} catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Xóa dữ liệu đi muộn thất bại:', error.message);
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
