import 'dotenv/config';
import pool from '../packages/database/index.js';

import { getDocById } from '../apps/bot/sheetManager.js';

async function run() {
    const res = await pool.query(`
        SELECT telegram_group_id, group_name, kpi_sheet_id, customer_sheet_id
        FROM telegram_groups
        WHERE (kpi_sheet_id IS NOT NULL AND kpi_sheet_id != '')
           OR (customer_sheet_id IS NOT NULL AND customer_sheet_id != '')
    `);
    console.log('TELEGRAM GROUPS SHEETS:');
    console.table(res.rows);
    console.log('ENV TIMEKEEP_SPREADSHEET_ID:', process.env.TIMEKEEP_SPREADSHEET_ID);
    console.log('ENV WAREHOUSE_SPREADSHEET_ID:', process.env.WAREHOUSE_SPREADSHEET_ID);
    await pool.end();
}
run();





















