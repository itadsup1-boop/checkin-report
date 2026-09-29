import 'dotenv/config';
import pool from '../packages/database/index.js';

async function main() {
    const tgid = '-4233999474';
    const groupUuid = 'a65bfffc-3821-43bd-a066-7e6e155cc391';

    const empRes = await pool.query(`
        SELECT id, full_name, telegram_id, role, is_active, group_id, telegram_group_id
        FROM employees
        WHERE group_id = $1 OR telegram_group_id = $2
    `, [groupUuid, tgid]);
    console.log('Employees pointing to UK:');
    console.table(empRes.rows);

    process.exit(0);
}

main().catch(console.error);
