import 'dotenv/config';
import pool from '../packages/database/index.js';
import { getDocById } from '../apps/bot/sheetManager.js';

async function check() {
    const res = await pool.query(
        "SELECT COUNT(id) as cnt, MIN(report_date) as min_d, MAX(report_date) as max_d FROM ktv_tour_reports WHERE group_id = '-4815602983'"
    );
    console.log('Database ktv_tour_reports count:', res.rows[0]);

    const ktvs = await pool.query(
        "SELECT unnest(ktv_names) as ktv, count(id) as tour_count, sum(tour_credit) as total_credit FROM ktv_tour_reports WHERE group_id = '-4815602983' GROUP BY 1 ORDER BY 3 DESC"
    );
    console.log('KTV stats in DB:');
    console.table(ktvs.rows);

    const doc = await getDocById('1kvRskpkkEQcLnTbwkhWqdJfpwpTcRqt8Kpj43pvjcR8');
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'];
    const rows = await sheet.getRows();
    console.log(`Sheet "${doc.title}" tab "TỔNG HỢP TOUR" has ${rows.length} rows.`);
    if (rows.length > 0) {
        console.log('Sample first row:', {
            STT: rows[0].get('STT'),
            Ngay: rows[0].get('Ngày'),
            Khach: rows[0].get('Họ tên khách'),
            KTV: rows[0].get('KTV'),
            CongTua: rows[0].get('Công tua')
        });
        console.log('Sample last row:', {
            STT: rows[rows.length - 1].get('STT'),
            Ngay: rows[rows.length - 1].get('Ngày'),
            Khach: rows[rows.length - 1].get('Họ tên khách'),
            KTV: rows[rows.length - 1].get('KTV'),
            CongTua: rows[rows.length - 1].get('Công tua')
        });
    }

    process.exit(0);
}

check().catch(e => {
    console.error(e);
    process.exit(1);
});
