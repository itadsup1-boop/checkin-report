import 'dotenv/config';
import ExcelJS from 'exceljs';
import pool from '../packages/database/index.js';

const SOURCE_EXCEL = 'C:/Users/ADMIN/Downloads/telegramReport/công tua UK.xlsx';

function parseDateToSql(dStr) {
    if (!dStr) return null;
    const parts = dStr.split('/');
    if (parts.length === 3) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return dStr;
}

function parseBillAmount(billStr) {
    if (!billStr) return 0;
    const clean = String(billStr).toLowerCase().replace(/[.,\s]/g, '');
    
    // e.g. 29tr800 -> 29,800,000
    const trKMatch = clean.match(/^(\d+)\s*tr\s*(\d+)/);
    if (trKMatch) {
        let kPart = trKMatch[2];
        if (kPart.length === 1) kPart += '00000';
        else if (kPart.length === 2) kPart += '0000';
        else if (kPart.length === 3) kPart += '000';
        return parseInt(trKMatch[1], 10) * 1000000 + parseInt(kPart, 10);
    }

    // e.g. 12tr, 1.5tr
    const trMatch = clean.match(/^(\d+(?:\.\d+)?)\s*tr/);
    if (trMatch) return parseFloat(trMatch[1]) * 1000000;

    // e.g. 500k
    const kMatch = clean.match(/^(\d+)\s*k/);
    if (kMatch) return parseInt(kMatch[1], 10) * 1000;

    const num = parseFloat(clean.replace(/\D/g, ''));
    if (!isNaN(num)) {
        if (num > 0 && num < 1000) return num * 1000000; // shorthand e.g. "11" -> 11tr
        return num;
    }
    return 0;
}

async function main() {
    console.log('=== BẮT ĐẦU IMPORT DỮ LIỆU CÔNG TOUR VÀO DATABASE (uk_tour_records) ===');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(SOURCE_EXCEL);

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Clear existing records
        await client.query('TRUNCATE TABLE public.uk_tour_records RESTART IDENTITY;');

        const monthsToImport = [
            { sheetName: 'Tháng 8.2026', month: 8, year: 2026 },
            { sheetName: 'Tháng 9.2026', month: 9, year: 2026 }
        ];

        let totalInserted = 0;

        for (const m of monthsToImport) {
            const ws = wb.getWorksheet(m.sheetName);
            if (!ws) {
                console.log(`Bỏ qua tab [${m.sheetName}] (không tìm thấy)`);
                continue;
            }

            let sheetInserted = 0;
            const rowsToInsert = [];

            ws.eachRow((row, rowNumber) => {
                if (rowNumber >= 3 && row.getCell(4).value) {
                    const stt = row.getCell(1).value || sheetInserted + 1;
                    const dateStr = String(row.getCell(2).value || '').trim();
                    const recordDate = parseDateToSql(dateStr);
                    const customerType = String(row.getCell(3).value || 'Cũ').trim();
                    const customerName = String(row.getCell(4).value || '').trim();
                    const phone = row.getCell(5).value ? String(row.getCell(5).value).trim() : '';
                    const service = row.getCell(6).value ? String(row.getCell(6).value).trim() : '';
                    const sessions = row.getCell(7).value ? String(row.getCell(7).value).trim() : '';
                    const bill = row.getCell(8).value ? String(row.getCell(8).value).trim() : '';
                    const billAmount = parseBillAmount(bill);
                    const notes = row.getCell(9).value ? String(row.getCell(9).value).trim() : '';
                    const ktv = row.getCell(10).value ? String(row.getCell(10).value).trim() : '';
                    const ktv1 = row.getCell(11).value ? String(row.getCell(11).value).trim() : '';
                    const ktv2 = row.getCell(12).value ? String(row.getCell(12).value).trim() : '';
                    const doctor = row.getCell(13).value ? String(row.getCell(13).value).trim() : '';

                    const soKtv = ktv1 && ktv2 ? 2 : (ktv1 ? 1 : 1);
                    const congTua = 0;
                    const congTy = 0;

                    rowsToInsert.push({
                        stt,
                        recordDate,
                        month: m.month,
                        year: m.year,
                        customerType,
                        customerName,
                        phone,
                        service,
                        sessions,
                        bill,
                        billAmount,
                        notes,
                        ktv,
                        ktv1,
                        ktv2,
                        doctor,
                        soKtv,
                        congTua,
                        congTy
                    });
                }
            });

            for (const r of rowsToInsert) {
                const query = `
                    INSERT INTO public.uk_tour_records (
                        stt, record_date, month, year, customer_type, customer_name, phone,
                        service, sessions, bill, bill_amount, notes, ktv, ktv1, ktv2, doctor,
                        so_ktv, cong_tua, cong_ty, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7,
                        $8, $9, $10, $11, $12, $13, $14, $15, $16,
                        $17, $18, $19, NOW(), NOW()
                    ) RETURNING id;
                `;
                const values = [
                    r.stt,
                    r.recordDate,
                    r.month,
                    r.year,
                    r.customerType,
                    r.customerName,
                    r.phone,
                    r.service,
                    r.sessions,
                    r.bill,
                    r.billAmount,
                    r.notes,
                    r.ktv,
                    r.ktv1,
                    r.ktv2,
                    r.doctor,
                    r.soKtv,
                    r.congTua,
                    r.congTy
                ];
                await client.query(query, values);
                sheetInserted++;
            }

            console.log(` -> Đã import [${m.sheetName}]: ${sheetInserted} ca vào database.`);
            totalInserted += sheetInserted;
        }

        await client.query('COMMIT');
        console.log(`\n=== IMPORT THÀNH CÔNG TỔNG CỘNG ${totalInserted} CA VÀO BẢNG uk_tour_records! ===`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi khi import vào database:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    process.exit(1);
});
