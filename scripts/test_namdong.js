import 'dotenv/config';
import pool from '../packages/database/index.js';
import { createSundayReminderRepository } from '../domains/timekeep/infrastructure/postgres/sunday-reminder-repository.js';

async function main() {
    const ndStaff = await pool.query(`
        SELECT id, full_name, telegram_id, role, is_active 
        FROM employees 
        WHERE telegram_group_id = '-5589101669'
    `);
    console.log('Nam Dong employees:');
    console.table(ndStaff.rows);
    process.exit(0);
}

main().catch(console.error);
