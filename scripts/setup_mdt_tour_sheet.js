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

async function setup() {
    console.log('Connecting to MDT Công Tour sheet:', SPREADSHEET_ID);
    const doc = await getDocById(SPREADSHEET_ID);
    await doc.loadInfo();
    console.log('Doc title:', doc.title);

    let sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'];
    if (!sheet) {
        if (doc.sheetsByIndex.length === 1 && doc.sheetsByIndex[0].title === 'Trang tính1') {
            sheet = doc.sheetsByIndex[0];
            await sheet.updateProperties({ title: 'TỔNG HỢP TOUR' });
            console.log('Renamed Trang tính1 -> TỔNG HỢP TOUR');
        } else {
            sheet = await doc.addSheet({ title: 'TỔNG HỢP TOUR' });
            console.log('Created new sheet TỔNG HỢP TOUR');
        }
    }

    await sheet.setHeaderRow(HEADERS);
    console.log('Header row set successfully!');

    const pool = (await import('../packages/database/index.js')).default;
    await pool.query(
        'UPDATE telegram_groups SET customer_sheet_id = $1 WHERE telegram_group_id = $2',
        [SPREADSHEET_ID, '-4815602983']
    );
    console.log('Updated telegram_groups customer_sheet_id for MDT (-4815602983) successfully!');
    process.exit(0);
}

setup().catch(err => {
    console.error('Error setting up sheet:', err);
    process.exit(1);
});
