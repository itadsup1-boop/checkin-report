import 'dotenv/config';
import pool from '../packages/database/index.js';
import { getDocById } from '../apps/bot/sheetManager.js';

async function checkUk() {
    console.log('--- Checking UK Database Data ---');

    // 1. ktv_tour_reports for UK
    const ktvRes = await pool.query(
        "SELECT count(id) as cnt, MIN(report_date) as min_d, MAX(report_date) as max_d FROM ktv_tour_reports WHERE group_id = '-1002228375063'"
    );
    console.log('ktv_tour_reports for UK:', ktvRes.rows[0]);

    // 2. uk_tour_records
    const ukRecordsCheck = await pool.query(`
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'uk_tour_records'
        );
    `);
    console.log('uk_tour_records exists:', ukRecordsCheck.rows[0].exists);
    if (ukRecordsCheck.rows[0].exists) {
        const ukRes = await pool.query("SELECT count(id) as cnt, MIN(record_date) as min_d, MAX(record_date) as max_d FROM uk_tour_records");
        console.log('uk_tour_records count:', ukRes.rows[0]);
    }

    // 3. customer_appointments for UK (-1002228375063)
    const apptsRes = await pool.query(`
        SELECT count(id) as cnt, MIN(appointment_time) as min_d, MAX(appointment_time) as max_d 
        FROM customer_appointments 
        WHERE group_id = '-1002228375063'
    `);
    console.log('customer_appointments for UK:', apptsRes.rows[0]);

    // 4. Check UK Google Sheet
    console.log('--- Checking UK Google Sheet ---');
    try {
        const doc = await getDocById('1qasjaqYLaQRSpQ7hknEHYwGhu7IkXF6j02WAspKn5kI');
        await doc.loadInfo();
        console.log('Doc title:', doc.title);
        const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'] || doc.sheetsById['854646535'];
        console.log('Sheet title:', sheet?.title, 'Sheet rowCount:', sheet?.rowCount);
        const rows = await sheet.getRows({ limit: 10 });
        console.log('First rows in sheet:', rows.length);
        if (rows.length > 0) {
            console.log('Sample row 0:', {
                STT: rows[0].get('STT'),
                Ngay: rows[0].get('Ngày'),
                Khach: rows[0].get('Họ tên khách'),
                KTV: rows[0].get('KTV'),
                BS: rows[0].get('Bác sĩ'),
                CongTua: rows[0].get('Công tua')
            });
        }
        const allRows = await sheet.getRows();
        console.log('Total data rows in UK sheet tab TỔNG HỢP TOUR:', allRows.length);
        if (allRows.length > 0) {
            console.log('Last row in UK sheet:', {
                STT: allRows[allRows.length - 1].get('STT'),
                Ngay: allRows[allRows.length - 1].get('Ngày'),
                Khach: allRows[allRows.length - 1].get('Họ tên khách'),
                KTV: allRows[allRows.length - 1].get('KTV'),
                BS: allRows[allRows.length - 1].get('Bác sĩ'),
                CongTua: allRows[allRows.length - 1].get('Công tua')
            });
        }
    } catch (err) {
        console.error('Error checking UK sheet:', err.message);
    }

    process.exit(0);
}

checkUk().catch(e => {
    console.error(e);
    process.exit(1);
});
