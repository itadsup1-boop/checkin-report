import 'dotenv/config';
import { getDocById } from '../apps/bot/sheetManager.js';

async function run() {
    const doc = await getDocById('1gQYXoylEysKKqUpYMxAzLw1nA7KC89eC-FO4kSzhlYU');
    await doc.loadInfo();

    // 1. Inspect SỔ PHẠT TELESALE
    const penaltySheet = doc.sheetsByTitle['SỔ PHẠT TELESALE'];
    if (penaltySheet) {
        const rows = await penaltySheet.getRows();
        console.log(`\n=== SỔ PHẠT TELESALE (${rows.length} rows) ===`);
        for (let i = 0; i < rows.length; i++) {
            console.log(`[Row ${i + 2}]`, rows[i]._rawData);
        }
    }

    // 2. Inspect Tab "Phương"
    const pSheet = doc.sheetsByTitle['Phương'];
    if (pSheet) {
        const rows = await pSheet.getRows();
        console.log(`\n=== TAB Phương (${rows.length} rows) ===`);
        for (let i = 0; i < rows.length; i++) {
            console.log(`[Row ${i + 2}]`, rows[i]._rawData);
        }
    }

    // 3. Inspect Tab "Trịnh Khánh Phương"
    const tkpSheet = doc.sheetsByTitle['Trịnh Khánh Phương'];
    if (tkpSheet) {
        const rows = await tkpSheet.getRows();
        console.log(`\n=== TAB Trịnh Khánh Phương (${rows.length} rows) ===`);
        for (let i = 0; i < rows.length; i++) {
            console.log(`[Row ${i + 2}]`, rows[i]._rawData);
        }
    }
}

run();
