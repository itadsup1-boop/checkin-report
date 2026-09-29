import 'dotenv/config';
import pool from '../packages/database/index.js';
import { getDocById } from '../apps/bot/sheetManager.js';

async function checkUkDetails() {
    // 1. Check UK sheet from row 280 to end
    const doc = await getDocById('1qasjaqYLaQRSpQ7hknEHYwGhu7IkXF6j02WAspKn5kI');
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'] || doc.sheetsById['854646535'];
    const rows = await sheet.getRows();
    console.log(`Total rows in UK Google Sheet: ${rows.length}`);

    // Print rows from 295 to 305
    console.log('--- Recent rows in UK Google Sheet ---');
    for (let i = Math.max(0, rows.length - 10); i < rows.length; i++) {
        const r = rows[i];
        console.log(`Row ${i} (STT ${r.get('STT')}): Ngày=${r.get('Ngày')} | Khách=${r.get('Họ tên khách')} | SĐT=${r.get('SĐT')} | KTV=${r.get('KTV')} | Công=${r.get('Công tua')} | BS=${r.get('Bác sĩ')}`);
    }

    // 2. Check ktv_tour_reports for UK in September
    const dbRows = await pool.query(`
        SELECT id, report_date::text as d_str, customer_name, phone, ktv_names, tour_credit, doctor, service
        FROM ktv_tour_reports
        WHERE group_id = '-1002228375063' AND report_date >= '2026-09-01'
        ORDER BY report_date ASC, id ASC
    `);
    console.log(`Total ktv_tour_reports in September for UK: ${dbRows.rows.length}`);
    console.log('--- Last 5 in DB ---');
    for (const r of dbRows.rows.slice(-5)) {
        console.log(`DB ID ${r.id}: Ngày=${r.d_str} | Khách=${r.customer_name} | KTV=${r.ktv_names} | Công=${r.tour_credit}`);
    }

    // 3. Count in UK Google Sheet for September (format DD/09/2026 or D/9/2026 or similar)
    const sepRows = rows.filter(r => {
        const date = (r.get('Ngày') || '').trim();
        return date.includes('/09/2026') || date.includes('/9/2026');
    });
    // 4. Check telegram_groups
    const grpRes = await pool.query("SELECT * FROM telegram_groups WHERE telegram_group_id IN ('-1002228375063', '-4815602983')");
    console.log('--- Telegram Groups Settings ---');
    console.table(grpRes.rows);

    process.exit(0);
}

checkUkDetails().catch(e => {
    console.error(e);
    process.exit(1);
});
