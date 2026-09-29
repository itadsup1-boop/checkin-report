import 'dotenv/config';
import pool from '../packages/database/index.js';
import { getDocById } from '../apps/bot/sheetManager.js';

const SPREADSHEET_ID = '1kvRskpkkEQcLnTbwkhWqdJfpwpTcRqt8Kpj43pvjcR8';
const GROUP_ID = '-4815602983';

function formatDateVN(d) {
    if (!d) return '';
    const date = new Date(d);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

async function syncMdt() {
    console.log(`Starting sync for MDT group ${GROUP_ID} from 2026-09-01 onwards...`);

    const apptsRes = await pool.query(`
        SELECT * FROM customer_appointments
        WHERE group_id = $1
          AND status = 'ARRIVED'
          AND (appointment_time >= '2026-09-01' OR created_at >= '2026-09-01')
        ORDER BY appointment_time ASC, id ASC
    `, [GROUP_ID]);

    const appts = apptsRes.rows;
    console.log(`Found ${appts.length} arrived tour appointments since Sep 1, 2026.`);

    // 1. Insert into ktv_tour_reports
    let insertedCount = 0;
    const syncedTours = [];

    for (const a of appts) {
        const ktv = (a.employee_name || 'KTV').trim();
        const dateStr = a.appointment_time
            ? new Date(a.appointment_time).toISOString().split('T')[0]
            : new Date(a.created_at).toISOString().split('T')[0];

        // Check if already in ktv_tour_reports
        const check = await pool.query(
            'SELECT id FROM ktv_tour_reports WHERE appointment_id = $1 OR (group_id = $2 AND report_date = $3::date AND phone = $4)',
            [a.id, GROUP_ID, dateStr, a.phone || '']
        );

        let tourRecord;
        if (check.rows.length === 0) {
            const ins = await pool.query(`
                INSERT INTO ktv_tour_reports (
                    group_id, telegram_user_id, reported_by, report_date,
                    customer_name, phone, customer_type, doctor, service,
                    ktv_names, tour_credit, appointment_id, photo_url,
                    notes, is_valid, status, raw_text, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4::date,
                    $5, $6, $7, $8, $9,
                    $10, $11, $12, $13,
                    $14, $15, $16, $17, $18, $19
                ) RETURNING *
            `, [
                GROUP_ID,
                a.telegram_id ? Number(a.telegram_id) : null,
                ktv,
                dateStr,
                (a.customer_name || 'Khách').trim(),
                a.phone ? a.phone.trim() : null,
                a.session_type === 'Mới' ? 'Khách mới' : 'Khách cũ',
                a.doctor ? a.doctor.trim() : null,
                a.service ? a.service.trim() : null,
                [ktv],
                1.00,
                a.id,
                a.proof_image || null,
                a.revenue ? `Bill: ${a.revenue}` : null,
                true,
                'VALID',
                `[Import MDT] ${a.customer_name} | SĐT: ${a.phone} | KTV: ${ktv}`,
                a.created_at || new Date(),
                a.updated_at || new Date()
            ]);
            tourRecord = ins.rows[0];
            insertedCount++;
        } else {
            tourRecord = check.rows[0];
        }
        syncedTours.push({ ...a, tourRecord, dateStr, ktv });
    }

    console.log(`Inserted ${insertedCount} new records into ktv_tour_reports.`);

    // 2. Write to Google Sheet
    console.log('Connecting to Google Sheet:', SPREADSHEET_ID);
    const doc = await getDocById(SPREADSHEET_ID);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['TỔNG HỢP TOUR'];
    if (!sheet) throw new Error('Sheet TỔNG HỢP TOUR not found');

    await sheet.loadHeaderRow();
    console.log('Current rowCount in sheet:', sheet.rowCount);

    // Clear existing rows (keep header)
    const existingRows = await sheet.getRows();
    if (existingRows.length > 0) {
        console.log(`Clearing ${existingRows.length} existing rows to ensure clean sync...`);
        for (const r of existingRows) {
            await r.delete();
        }
    }

    const rowsToAdd = [];
    let stt = 1;

    for (const item of syncedTours) {
        const isHoa = item.ktv.toLowerCase().includes('hoa');
        const isNgoc = item.ktv.toLowerCase().includes('ngọc') || item.ktv.toLowerCase().includes('ngoc');
        const isTrung = item.ktv.toLowerCase().includes('trung');

        rowsToAdd.push({
            'STT': String(stt++),
            'Ngày': formatDateVN(item.appointment_time || item.created_at),
            'Khách\n(Mới/Cũ)': item.session_type === 'Mới' ? 'Mới' : 'Cũ',
            'Họ tên khách': (item.customer_name || '').trim(),
            'SĐT': item.phone || '',
            'Dịch vụ': item.service || '',
            'Buổi': item.sessions || '',
            'Bill': item.revenue || '',
            'Ghi chú\n(Tặng/BH)': item.tourRecord?.notes || '',
            'KTV': item.ktv,
            'KTV1': item.ktv,
            'KTV2': '',
            'Bác sĩ': item.doctor || '',
            'Số KTV / Ca': '1',
            'Công tua': '1',
            'Công ty': '0',
            'Hoa': isHoa ? '1' : '0',
            'Ngọc': isNgoc ? '1' : '0',
            'Trung': isTrung ? '1' : '0',
            'Trần Phương Hoa': isHoa ? '1' : '0',
            'Trần Ngọc': isNgoc ? '1' : '0',
            'x': '0',
            'Tổng': '1'
        });
    }

    console.log(`Adding ${rowsToAdd.length} rows to Google Sheet TỔNG HỢP TOUR...`);
    // Add in chunks of 20 to avoid rate limits
    for (let i = 0; i < rowsToAdd.length; i += 20) {
        const chunk = rowsToAdd.slice(i, i + 20);
        await sheet.addRows(chunk);
        console.log(`Added rows ${i + 1} to ${Math.min(i + 20, rowsToAdd.length)}`);
    }

    console.log('✅ Sync completed successfully!');
    process.exit(0);
}

syncMdt().catch(err => {
    console.error('Lỗi sync MDT:', err);
    process.exit(1);
});
