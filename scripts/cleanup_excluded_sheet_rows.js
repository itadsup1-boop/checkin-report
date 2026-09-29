import 'dotenv/config';
import { getDocById } from '../apps/bot/sheetManager.js';
import { isExcludedSheetEmployee } from '../packages/shared/excluded-employees.js';
import pool from '../packages/database/index.js';

async function cleanupTelesaleSheet() {
    const sheetId = '1gQYXoylEysKKqUpYMxAzLw1nA7KC89eC-FO4kSzhlYU';
    console.log(`\n=== 1. CLEANING TELESALE SHEET (${sheetId}) ===`);
    const doc = await getDocById(sheetId);
    if (!doc) {
        console.log('Cannot load telesale sheet');
        return;
    }
    await doc.loadInfo();

    // 1. Clean Master sheet
    const masterSheet = doc.sheetsByIndex[0];
    const rows = await masterSheet.getRows();
    console.log(`Master sheet "${masterSheet.title}" has ${rows.length} rows.`);
    
    // Delete in reverse order to preserve row indices
    let deletedCount = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i];
        const name = (row.get('Nhân sự') || row.get('Họ và tên') || '').trim();
        if (isExcludedSheetEmployee(name)) {
            console.log(`Deleting row ${i + 2}: [${name}] date=${row.get('Ngày')}`);
            await row.delete();
            deletedCount++;
        }
    }
    console.log(`Deleted ${deletedCount} rows from Telesale master sheet.`);

    // 2. Clean any personal tabs belonging to excluded employees
    for (const [title, s] of Object.entries(doc.sheetsByTitle)) {
        if (isExcludedSheetEmployee(title)) {
            console.log(`Deleting sheet tab "${title}"...`);
            try {
                await s.delete();
                console.log(`Deleted tab "${title}".`);
            } catch (e) {
                console.error(`Failed to delete tab "${title}":`, e.message);
            }
        }
    }
}

async function checkOtherSheets() {
    console.log('\n=== 2. CHECKING OTHER SHEETS ===');
    const res = await pool.query(`
        SELECT telegram_group_id, group_name, kpi_sheet_id, customer_sheet_id
        FROM telegram_groups
        WHERE (kpi_sheet_id IS NOT NULL AND kpi_sheet_id != '')
           OR (customer_sheet_id IS NOT NULL AND customer_sheet_id != '')
    `);

    const sheetIds = new Set();
    if (process.env.TIMEKEEP_SPREADSHEET_ID) sheetIds.add(process.env.TIMEKEEP_SPREADSHEET_ID);
    for (const row of res.rows) {
        if (row.kpi_sheet_id) sheetIds.add(row.kpi_sheet_id);
        if (row.customer_sheet_id && row.customer_sheet_id !== '1gQYXoylEysKKqUpYMxAzLw1nA7KC89eC-FO4kSzhlYU') {
            sheetIds.add(row.customer_sheet_id);
        }
    }

    for (const sid of sheetIds) {
        try {
            const doc = await getDocById(sid);
            if (!doc) continue;
            await doc.loadInfo();
            console.log(`Checking doc: "${doc.title}" (${sid})`);

            // Check if any tab title is excluded
            for (const [title, s] of Object.entries(doc.sheetsByTitle)) {
                if (isExcludedSheetEmployee(title)) {
                    console.log(`Found excluded tab "${title}" in doc "${doc.title}". Deleting...`);
                    try {
                        await s.delete();
                        console.log(`Deleted tab "${title}".`);
                    } catch (e) {
                        console.error(`Could not delete tab "${title}":`, e.message);
                    }
                }
            }

            // Check first sheet for any excluded rows
            const firstSheet = doc.sheetsByIndex[0];
            if (firstSheet) {
                const rows = await firstSheet.getRows();
                for (let i = rows.length - 1; i >= 0; i--) {
                    const row = rows[i];
                    const name = (row.get('Họ và tên') || row.get('Nhân viên') || row.get('Nhân sự') || row.get('Họ tên khách') || '').trim();
                    if (isExcludedSheetEmployee(name)) {
                        console.log(`Found excluded row in "${firstSheet.title}": [${name}]. Deleting...`);
                        await row.delete();
                    }
                }
            }
        } catch (err) {
            console.warn(`Error checking sheet ${sid}:`, err.message);
        }
    }
}

async function run() {
    try {
        await cleanupTelesaleSheet();
        await checkOtherSheets();
    } catch (err) {
        console.error('Fatal error in cleanup:', err);
    } finally {
        await pool.end();
        console.log('\n=== DONE CLEANUP ===');
    }
}

run();
