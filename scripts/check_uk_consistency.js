import 'dotenv/config';
import pool from '../packages/database/index.js';
import { getDocById } from '../apps/bot/sheetManager.js';

async function checkSyncConsistency() {
    const doc = await getDocById('1qasjaqYLaQRSpQ7hknEHYwGhu7IkXF6j02WAspKn5kI');
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'] || doc.sheetsById['854646535'];
    const sheetRows = await sheet.getRows();

    // Filter sheet rows for September
    const sepSheetRows = sheetRows.filter(r => {
        const d = (r.get('Ngày') || '').trim();
        return (d.includes('/09/2026') || d.includes('/9/2026')) && (r.get('Họ tên khách') || '').trim() !== '';
    });

    console.log(`September valid sheet rows: ${sepSheetRows.length}`);

    // Get DB rows for September
    const dbRes = await pool.query(`
        SELECT id, report_date::text as d_str, customer_name, phone, ktv_names, tour_credit 
        FROM ktv_tour_reports 
        WHERE group_id = '-1002228375063' AND report_date >= '2026-09-01'
        ORDER BY report_date ASC, id ASC
    `);
    const dbRows = dbRes.rows;
    console.log(`September DB rows: ${dbRows.length}`);

    let matched = 0;
    let missingInDb = [];

    for (const sr of sepSheetRows) {
        const sName = (sr.get('Họ tên khách') || '').trim().toLowerCase();
        const sPhone = (sr.get('SĐT') || '').trim();
        const sDate = (sr.get('Ngày') || '').trim();

        // convert sDate DD/MM/YYYY to YYYY-MM-DD
        const parts = sDate.split('/');
        const sDateIso = parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : '';

        const found = dbRows.find(dr => {
            const drName = (dr.customer_name || '').trim().toLowerCase();
            const drDate = dr.d_str;
            return drName === sName && (drDate === sDateIso || dr.phone === sPhone);
        });

        if (found) {
            matched++;
        } else {
            missingInDb.push({
                STT: sr.get('STT'),
                Ngày: sDate,
                Khách: sr.get('Họ tên khách'),
                SĐT: sr.get('SĐT'),
                KTV: sr.get('KTV')
            });
        }
    }

    console.log(`Matched: ${matched}/${sepSheetRows.length}`);
    if (missingInDb.length > 0) {
        console.log('Missing in DB:', missingInDb);
    } else {
        console.log('ALL September rows in UK Google Sheet are 100% matched in database!');
    }

    process.exit(0);
}

checkSyncConsistency().catch(e => {
    console.error(e);
    process.exit(1);
});
