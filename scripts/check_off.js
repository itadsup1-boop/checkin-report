import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';

async function run() {
    const dateStr = '2026-08-23';
    
    const emps = await pool.query(
        "SELECT id, full_name, telegram_id, role, group_id FROM employees WHERE full_name ILIKE '%nhung%' OR full_name ILIKE '%trang%'"
    );
    console.log('Employees:', emps.rows);

    for (const emp of emps.rows) {
        const statuses = await pool.query(
            "SELECT * FROM tk_attendance_daily_status WHERE user_id = $1 AND date::text LIKE $2",
            [emp.id, `${dateStr}%`]
        );
        console.log(`Status for ${emp.full_name}:`, statuses.rows);

        const penalties = await pool.query(
            "SELECT * FROM tk_penalties WHERE user_id = $1 AND date::text LIKE $2",
            [emp.id, `${dateStr}%`]
        );
        console.log(`Penalties for ${emp.full_name}:`, penalties.rows);
    }
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
