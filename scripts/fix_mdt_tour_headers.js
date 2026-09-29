import 'dotenv/config';
import { getDocById } from '../apps/bot/sheetManager.js';

const SPREADSHEET_ID = '1kvRskpkkEQcLnTbwkhWqdJfpwpTcRqt8Kpj43pvjcR8';

const HEADERS = [
    'STT',
    'Ngày',
    'Khách\n(Mới/Cũ)',
    'Họ tên khách',
    'SĐT',
    'Dịch vụ',
    'Buổi',
    'Bill',
    'Ghi chú\n(Tặng/BH)',
    'KTV',
    'KTV1',
    'KTV2',
    'Bác sĩ',
    'Số KTV / Ca',
    'Công tua',
    'Công ty',
    'Hoa',
    'Ngọc',
    'Trung',
    'Trần Phương Hoa',
    'Trần Ngọc',
    'x',
    'Tổng'
];

async function fixHeaders() {
    console.log('Connecting to MDT sheet:', SPREADSHEET_ID);
    const doc = await getDocById(SPREADSHEET_ID);
    await doc.loadInfo();
    console.log('Doc title:', doc.title);

    const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'];
    if (!sheet) {
        throw new Error('Sheet "TỔNG HỢP TOUR" not found!');
    }

    console.log('Current headers before update:');
    await sheet.loadCells('A1:W1');
    const oldHeaders = [];
    for (let c = 0; c < HEADERS.length; c++) {
        oldHeaders.push(sheet.getCell(0, c).value);
    }
    console.log(oldHeaders);

    console.log('\nSetting correct tour headers...');
    await sheet.setHeaderRow(HEADERS);

    // Format row 1: bold, centered, yellow background matching the template
    await sheet.loadCells('A1:W1');
    for (let c = 0; c < HEADERS.length; c++) {
        const cell = sheet.getCell(0, c);
        cell.textFormat = { bold: true };
        cell.horizontalAlignment = 'CENTER';
        cell.verticalAlignment = 'MIDDLE';
    }
    await sheet.saveUpdatedCells();

    console.log('✅ Headers updated and saved successfully!');

    // Re-read to confirm
    await sheet.loadCells('A1:W1');
    const updated = [];
    for (let c = 0; c < HEADERS.length; c++) {
        updated.push(sheet.getCell(0, c).value);
    }
    console.log('\nUpdated headers in sheet:');
    console.log(updated);
}

fixHeaders().catch(err => {
    console.error('Error fixing headers:', err);
    process.exit(1);
});
