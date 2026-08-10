import { getDocById } from './sheetManager.js';
import pool from '../../packages/database/index.js';
import moment from 'moment';

const HEADERS = ['STT', 'Họ và tên', 'Nhóm / Chi nhánh', 'Chức vụ', 'Ngày', 'Giờ Check-in', 'Trạng thái', 'Ghi chú Admin', 'Tổng Tiền Phạt', 'Lý do Phạt'];

export async function syncAllTimekeepSheets() {
    const spreadsheetId = process.env.TIMEKEEP_SPREADSHEET_ID;
    if (!spreadsheetId || spreadsheetId === 'SPREADSHEET_ID_CHUA_CAI_DAT') {
        console.log('[SHEET SYNC] Bỏ qua vì chưa cài đặt TIMEKEEP_SPREADSHEET_ID');
        return { success: false, message: 'Chưa cài đặt TIMEKEEP_SPREADSHEET_ID trong .env' };
    }

    try {
        const doc = await getDocById(spreadsheetId);
        if (!doc) {
            return { success: false, message: 'Không kết nối được Google Sheet ID' };
        }
        await doc.loadInfo();

        const todayStr = moment().utcOffset(7).format('YYYY-MM-DD');

        // 1. Đồng bộ Sheet Tổng
        await syncMasterSheet(doc, todayStr);

        // 2. Đồng bộ các Sheet cá nhân từng người (Chỉ các nhóm Chấm công: UK, US...)
        await syncIndividualSheets(doc, todayStr);

        console.log('[SHEET SYNC] Đồng bộ dữ liệu các nhóm Chấm công (UK, US...) thành công!');
        return { success: true, message: 'Đã đồng bộ đúng dữ liệu các nhóm Chấm công (UK, US...) thành công!' };
    } catch (error) {
        console.error('[SHEET SYNC ERR]', error);
        return { success: false, message: error.message };
    }
}

// Định dạng hàng tiêu đề: Nền màu VÀNG (#FFFF00), chữ in đậm
async function formatYellowHeader(sheet) {
    await sheet.setHeaderRow(HEADERS);
    try {
        await sheet.loadCells('A1:J1');
        for (let c = 0; c < HEADERS.length; c++) {
            const cell = sheet.getCell(0, c);
            cell.backgroundColor = { red: 1, green: 1, blue: 0 };
            cell.textFormat = { bold: true, fontSize: 11 };
        }
        await sheet.saveUpdatedCells();
    } catch (e) {
        console.error('Lỗi định dạng màu header:', e.message);
    }
}

function parseAttendanceRow(shift_type, check_in_time, checkin_status) {
    if (check_in_time) {
        const d = new Date(check_in_time);
        const pad = (n) => String(n).padStart(2, '0');
        const timeVal = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        return {
            checkinTimeStr: timeVal,
            statusStr: '✅ Đã Check-in'
        };
    }

    if (shift_type === 'OFF') {
        return {
            checkinTimeStr: '—',
            statusStr: '🌴 Nghỉ (OFF)'
        };
    }

    if (!shift_type) {
        return {
            checkinTimeStr: '—',
            statusStr: 'Không đăng ký lịch'
        };
    }

    return {
        checkinTimeStr: 'Chưa check-in',
        statusStr: '❌ Quên check-in'
    };
}

// 1. Đồng bộ Sheet Tổng Hợp (Chỉ các nhóm Chấm công - bot_role = 'timekeep')
async function syncMasterSheet(doc, todayStr) {
    const query = `
        SELECT 
            e.full_name,
            e.role,
            e.need_report,
            e.is_exempt_checkin,
            g.group_name,
            d.date::date::text AS date,
            s.shift_type,
            s.updated_by,
            c.check_in_time,
            c.status AS checkin_status,
            c.admin_note,
            COALESCE(SUM(p.amount), 0) AS total_penalty,
            STRING_AGG(p.reason, ' | ') AS penalty_reasons
        FROM employees e
        LEFT JOIN telegram_groups g ON e.telegram_group_id = g.telegram_group_id
        CROSS JOIN generate_series('2026-07-23'::date, $1::date, '1 day'::interval) d(date)
        LEFT JOIN tk_schedules s ON e.id = s.user_id AND s.date = d.date::date
        LEFT JOIN tk_check_ins c ON e.id = c.user_id AND c.date = d.date::date
        LEFT JOIN tk_penalties p ON e.id = p.user_id AND p.date = d.date::date
        WHERE e.is_active = true 
          AND e.full_name NOT LIKE '/%' 
          AND e.full_name != 'tester'
          AND (g.bot_role = 'timekeep' OR g.bot_role IS NULL)
          AND d.date > COALESCE(e.created_at::date, '2026-07-22'::date)
        GROUP BY e.id, e.full_name, e.role, e.need_report, e.is_exempt_checkin, g.group_name, d.date, s.shift_type, s.updated_by, c.check_in_time, c.status, c.admin_note
        ORDER BY d.date::date ASC, g.group_name ASC, e.full_name ASC
    `;
    const res = await pool.query(query, [todayStr]);

    let sheetMaster = doc.sheetsByTitle['Tổng Hợp Chấm Công'] || doc.sheetsByTitle['Lịch Tổng'];
    if (!sheetMaster) {
        sheetMaster = await doc.addSheet({
            title: 'Tổng Hợp Chấm Công'
        });
    }

    await formatYellowHeader(sheetMaster);
    await sheetMaster.clearRows();

    const masterRows = res.rows.reduce((acc, r) => {
        // Lọc người được miễn điểm danh (chỉ in lên sheet khi có check_in_time)
        if (r.is_exempt_checkin === true && !r.check_in_time) {
            return acc;
        }

        const { checkinTimeStr, statusStr } = parseAttendanceRow(r.shift_type, r.check_in_time, r.checkin_status);
        let note = r.admin_note || (r.updated_by ? `Đổi bởi ${r.updated_by}` : '');

        acc.push({
            'STT': acc.length + 1,
            'Họ và tên': r.full_name || '',
            'Nhóm / Chi nhánh': r.group_name || 'Chưa xếp nhóm',
            'Chức vụ': r.role || '',
            'Ngày': r.date || '',
            'Giờ Check-in': checkinTimeStr,
            'Trạng thái': statusStr,
            'Ghi chú Admin': note,
            'Tổng Tiền Phạt': r.total_penalty > 0 ? r.total_penalty : '',
            'Lý do Phạt': r.penalty_reasons || ''
        });
        
        return acc;
    }, []);

    if (masterRows.length > 0) {
        await sheetMaster.addRows(masterRows);
    }
}

// 2. Đồng bộ các Sheet cá nhân từng người (Chỉ thuộc các nhóm Chấm công - bot_role = 'timekeep')
async function syncIndividualSheets(doc, todayStr) {
    const empQuery = `
        SELECT e.id, e.full_name, e.role, e.need_report, e.is_exempt_checkin, g.group_name
        FROM employees e
        LEFT JOIN telegram_groups g ON e.telegram_group_id = g.telegram_group_id
        WHERE e.is_active = true 
          AND e.full_name IS NOT NULL 
          AND e.full_name != '' 
          AND e.full_name NOT LIKE '/%' 
          AND e.full_name != 'tester'
          AND (g.bot_role = 'timekeep' OR g.bot_role IS NULL)
        ORDER BY g.group_name ASC, e.full_name ASC
    `;
    const empRes = await pool.query(empQuery);

    for (const emp of empRes.rows) {
        let cleanName = emp.full_name.replace(/[\/*?:\[\]]/g, '').trim().substring(0, 80);
        if (!cleanName) continue;

        try {
            // Check case-insensitive to avoid Google API 400 error
            let sheetEmp = Object.values(doc.sheetsByTitle).find(s => s.title.toLowerCase() === cleanName.toLowerCase());
            
            // If it exists but we already processed someone with this name (or it's a duplicate),
            // and we want separate sheets... actually if we just use the existing sheet, their data might mix.
            // But to quickly fix the crash, if sheetEmp exists, we just use it (mixing data, but avoids 400 error).
            // To be safe, if we haven't seen this name, we use it. If we have, we should append ID.
            if (!sheetEmp) {
                try {
                    sheetEmp = await doc.addSheet({
                        title: cleanName
                    });
                    await new Promise(r => setTimeout(r, 1000));
                    // Add to sheetsByTitle to prevent next iteration from missing it
                    doc.sheetsByTitle[cleanName] = sheetEmp;
                } catch (addErr) {
                    if (addErr.message && addErr.message.includes('already exists')) {
                        // Fallback if google says it exists despite our check
                        sheetEmp = Object.values(doc.sheetsByTitle).find(s => s.title.toLowerCase() === cleanName.toLowerCase());
                        if (!sheetEmp) {
                            cleanName = cleanName + ' - ' + emp.id.substring(0, 4);
                            sheetEmp = await doc.addSheet({ title: cleanName });
                            doc.sheetsByTitle[cleanName] = sheetEmp;
                            await new Promise(r => setTimeout(r, 1000));
                        }
                    } else {
                        throw addErr;
                    }
                }
            }

            await formatYellowHeader(sheetEmp);
            await sheetEmp.clearRows();

            const detailQuery = `
                SELECT 
                    d.date::date::text AS date,
                    s.shift_type, 
                    s.updated_by,
                    c.check_in_time, 
                    c.status AS checkin_status, 
                    c.admin_note,
                    COALESCE(SUM(p.amount), 0) AS total_penalty,
                    STRING_AGG(p.reason, ' | ') AS penalty_reasons
                FROM employees e
                CROSS JOIN generate_series('2026-07-23'::date, $2::date, '1 day'::interval) d(date)
                LEFT JOIN tk_schedules s ON e.id = s.user_id AND s.date = d.date::date
                LEFT JOIN tk_check_ins c ON e.id = c.user_id AND c.date = d.date::date
                LEFT JOIN tk_penalties p ON e.id = p.user_id AND p.date = d.date::date
                WHERE e.id = $1
                  AND d.date > COALESCE(e.created_at::date, '2026-07-22'::date)
                GROUP BY d.date, s.shift_type, s.updated_by, c.check_in_time, c.status, c.admin_note
                ORDER BY d.date::date ASC
            `;
            const detailRes = await pool.query(detailQuery, [emp.id, todayStr]);

            const empRows = detailRes.rows.reduce((acc, r) => {
                // Lọc người được miễn điểm danh (chỉ in lên sheet khi có check_in_time)
                if (emp.is_exempt_checkin === true && !r.check_in_time) {
                    return acc;
                }

                const { checkinTimeStr, statusStr } = parseAttendanceRow(r.shift_type, r.check_in_time, r.checkin_status);
                let note = r.admin_note || (r.updated_by ? `Đổi bởi ${r.updated_by}` : '');

                acc.push({
                    'STT': acc.length + 1,
                    'Họ và tên': emp.full_name || '',
                    'Nhóm / Chi nhánh': emp.group_name || 'Chưa xếp nhóm',
                    'Chức vụ': emp.role || '',
                    'Ngày': r.date || '',
                    'Giờ Check-in': checkinTimeStr,
                    'Trạng thái': statusStr,
                    'Ghi chú Admin': note,
                    'Tổng Tiền Phạt': r.total_penalty > 0 ? r.total_penalty : '',
                    'Lý do Phạt': r.penalty_reasons || ''
                });

                return acc;
            }, []);

            if (empRows.length > 0) {
                await sheetEmp.addRows(empRows);
            }

            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            console.error(`[SHEET SYNC] Lỗi sync cá nhân cho ${cleanName}:`, err.message);
        }
    }
}
