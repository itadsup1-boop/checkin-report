import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';
import { syncAllTimekeepSheets } from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/apps/bot/syncTimekeepSheets.js';

async function run() {
    console.log("Checking test group...");
    const testGroups = await pool.query("SELECT * FROM telegram_groups WHERE group_name ILIKE '%test%'");
    console.log("Test groups:", testGroups.rows);

    const testUsers = await pool.query(`
        SELECT id, full_name, is_active FROM employees 
        WHERE full_name ILIKE '%Boss%' OR full_name ILIKE '%Đỗ thị thúy vân%'
    `);
    console.log("Test users:", testUsers.rows);

    console.log("Running sync sheets...");
    try {
        await syncAllTimekeepSheets();
        console.log("Sync finished successfully.");
    } catch (e) {
        console.error("Sync error:", e);
    }
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
