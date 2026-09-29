import 'dotenv/config';
import { getDocById } from '../apps/bot/sheetManager.js';

async function run() {
    try {
        const SPREADSHEET_ID = '1kvRskpkkEQcLnTbwkhWqdJfpwpTcRqt8Kpj43pvjcR8';
        const doc = await getDocById(SPREADSHEET_ID);
        await doc.loadInfo();
        const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'];
        await sheet.loadCells('A1:Z10');
        
        console.log('--- MDT CÔNG TOUR: TỔNG HỢP TOUR ---');
        console.log('Column count:', sheet.columnCount);
        for (let c = 0; c < sheet.columnCount; c++) {
            const letter = String.fromCharCode(65 + c);
            const header = sheet.getCell(0, c).value;
            const samples = [
                sheet.getCell(1, c).value,
                sheet.getCell(2, c).value,
                sheet.getCell(3, c).value,
                sheet.getCell(4, c).value
            ];
            console.log(`Col ${letter} (${c}): Header="${header}" | Samples=${JSON.stringify(samples)}`);
        }
    } catch (e) {
        console.error(e);
    }
}
run();
