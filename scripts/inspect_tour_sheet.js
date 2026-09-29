import 'dotenv/config';
import { getDocById } from '../apps/bot/sheetManager.js';

async function run() {
    try {
        const doc = await getDocById('1qasjaqYLaQRSpQ7hknEHYwGhu7IkXF6j02WAspKn5kI');
        await doc.loadInfo();
        console.log('Doc title:', doc.title);
        console.log('Sheets count:', doc.sheetsByIndex.length);
        
        for (const sheet of doc.sheetsByIndex) {
            console.log(`- Sheet title: "${sheet.title}", sheetId: ${sheet.sheetId}, rowCount: ${sheet.rowCount}`);
            if (String(sheet.sheetId) === '854646535') {
                console.log(`\nFound matching sheet: "${sheet.title}" (gid: 854646535)`);
                await sheet.loadHeaderRow();
                console.log('Headers:', sheet.headerValues);
                const rows = await sheet.getRows({ limit: 5 });
                console.log('Sample rows count:', rows.length);
                if (rows.length > 0) {
                    console.log('Sample row 0:', rows[0].toObject());
                }
            }
        }
    } catch (err) {
        console.error('Error inspecting sheet:', err);
    }
    process.exit(0);
}

run();
