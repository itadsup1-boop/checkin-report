import 'dotenv/config';
import { getDocById } from '../apps/bot/sheetManager.js';

async function checkUkHeaders() {
    const doc = await getDocById('1qasjaqYLaQRSpQ7hknEHYwGhu7IkXF6j02WAspKn5kI');
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'] || doc.sheetsById['854646535'];
    await sheet.loadHeaderRow();
    console.log('UK Google Sheet Headers:');
    console.log(sheet.headerValues);

    process.exit(0);
}

checkUkHeaders().catch(e => {
    console.error(e);
    process.exit(1);
});
