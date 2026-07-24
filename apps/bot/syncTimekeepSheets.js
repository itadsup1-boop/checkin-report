import { getDocById } from './sheetManager.js';
import pool from '../../packages/database/index.js';
import moment from 'moment';

const HEADERS = ['STT', 'Họ và tên', 'Nhóm / Chi nhánh', 'Chức vụ', 'Ngày', 'Giờ Check-in', 'Trạng thái', 'Ghi chú Admin'];

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
        await sheet.loadCells('A1:H1');
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
            g.group_name,
            COALESCE(s.date, c.date, $1::date)::text AS date,
            s.shift_type,
            s.updated_by,
            c.check_in_time,
            c.status AS checkin_status,
            c.admin_note
        FROM employees e
        LEFT JOIN telegram_groups g ON e.telegram_group_id = g.telegram_group_id
        LEFT JOIN tk_schedules s ON e.id = s.user_id AND s.date = $1::date
        LEFT JOIN tk_check_ins c ON e.id = c.user_id AND c.date = $1::date
        WHERE e.is_active = true 
          AND e.full_name NOT LIKE '/%' 
          AND e.full_name != 'tester'
          AND (g.bot_role = 'timekeep' OR g.bot_role IS NULL)
        ORDER BY g.group_name ASC, e.full_name ASC
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

    const masterRows = res.rows.map((r, index) => {
        const { checkinTimeStr, statusStr } = parseAttendanceRow(r.shift_type, r.check_in_time, r.checkin_status);
        let note = r.admin_note || (r.updated_by ? `Đổi bởi ${r.updated_by}` : '');

        return {
            'STT': index + 1,
            'Họ và tên': r.full_name || '',
            'Nhóm / Chi nhánh': r.group_name || 'Chưa xếp nhóm',
            'Chức vụ': r.role || '',
            'Ngày': r.date || '',
            'Giờ Check-in': checkinTimeStr,
            'Trạng thái': statusStr,
            'Ghi chú Admin': note
        };
    });

    if (masterRows.length > 0) {
        await sheetMaster.addRows(masterRows);
    }
}

// 2. Đồng bộ các Sheet cá nhân từng người (Chỉ thuộc các nhóm Chấm công - bot_role = 'timekeep')
async function syncIndividualSheets(doc, todayStr) {
    const empQuery = `
        SELECT e.id, e.full_name, e.role, g.group_name
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
            let sheetEmp = doc.sheetsByTitle[cleanName];
            if (!sheetEmp) {
                sheetEmp = await doc.addSheet({
                    title: cleanName
                });
                await new Promise(r => setTimeout(r, 1000));
            }

            await formatYellowHeader(sheetEmp);
            await sheetEmp.clearRows();

            const detailQuery = `
                SELECT 
                    COALESCE(s.date, c.date, $2::date)::text AS date,
                    s.shift_type, 
                    s.updated_by,
                    c.check_in_time, 
                    c.status AS checkin_status, 
                    c.admin_note
                FROM employees e
                LEFT JOIN tk_schedules s ON e.id = s.user_id AND s.date = $2::date
                LEFT JOIN tk_check_ins c ON e.id = c.user_id AND c.date = $2::date
                WHERE e.id = $1
            `;
            const detailRes = await pool.query(detailQuery, [emp.id, todayStr]);

            const empRows = detailRes.rows.map((r, index) => {
                const { checkinTimeStr, statusStr } = parseAttendanceRow(r.shift_type, r.check_in_time, r.checkin_status);
                let note = r.admin_note || (r.updated_by ? `Đổi bởi ${r.updated_by}` : '');

                return {
                    'STT': index + 1,
                    'Họ và tên': emp.full_name || '',
                    'Nhóm / Chi nhánh': emp.group_name || 'Chưa xếp nhóm',
                    'Chức vụ': emp.role || '',
                    'Ngày': r.date || '',
                    'Giờ Check-in': checkinTimeStr,
                    'Trạng thái': statusStr,
                    'Ghi chú Admin': note
                };
            });

            if (empRows.length > 0) {
                await sheetEmp.addRows(empRows);
            }

            await new Promise(r => setTimeout(r, 1000));
        } catch (err) {
            console.error(`[SHEET SYNC] Lỗi sync cá nhân cho ${cleanName}:`, err.message);
        }
    }
}
