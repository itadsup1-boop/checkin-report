import 'dotenv/config';
import moment from 'moment';
import pool from '../packages/database/index.js';
import { getDocById } from '../apps/bot/sheetManager.js';
import { buildCustomerSheetRowKey } from '../apps/bot/customer-sheet-routing.js';

const GROUP_ID = process.env.BACKFILL_GROUP_ID || '-1002148193072';
const FROM_DATE = process.env.BACKFILL_FROM_DATE || '2026-08-01';
const TO_DATE = process.env.BACKFILL_TO_DATE || '2026-09-01';
const APPLY = process.argv.includes('--apply');
const HEADERS = [
    'Ngày', 'Nhân Viên', 'Mã NV', 'Khách Hàng', 'SĐT', 'Dịch Vụ',
    'Buổi Làm', 'Thời Gian', 'Trạng Thái', 'Lý Do Hủy', 'Thu Tiền', 'Ảnh Chứng Thực'
];

async function ensureSheet(doc, title) {
    let sheet = doc.sheetsByTitle[title];
    if (!sheet) {
        if (!APPLY) return null;
        sheet = await doc.addSheet({ title, headerValues: HEADERS });
    }
    return sheet;
}

async function loadRows(sheet) {
    return sheet ? await sheet.getRows() : [];
}

async function addIfMissing(sheet, rows, rowData) {
    const key = buildCustomerSheetRowKey(rowData);
    const existing = rows.find(row => buildCustomerSheetRowKey(row) === key);
    if (existing) return { row: existing, added: false };
    if (!APPLY || !sheet) return { row: null, added: true };
    const row = await sheet.addRow(rowData);
    rows.push(row);
    return { row, added: true };
}

function fallbackStatus(appointment) {
    if (appointment.status === 'ARRIVED' && appointment.proof_image) return 'Đã hoàn thành';
    if (appointment.status === 'ARRIVED') return 'Khách đã đến';
    return 'Có lịch nhưng chưa hoàn thành công tour';
}

function rowDataFromAppointment(appointment) {
    return {
        'Ngày': moment(appointment.appointment_time).format('DD/MM/YYYY'),
        'Nhân Viên': appointment.employee_name,
        'Mã NV': appointment.employee_code || '',
        'Khách Hàng': appointment.customer_name,
        'SĐT': appointment.phone || '',
        'Dịch Vụ': appointment.service || '',
        'Buổi Làm': appointment.sessions || '',
        'Thời Gian': moment(appointment.appointment_time).format('HH:mm DD/MM/YYYY'),
        'Trạng Thái': fallbackStatus(appointment),
        'Lý Do Hủy': appointment.cancel_reason || '',
        'Thu Tiền': appointment.revenue || '',
        'Ảnh Chứng Thực': appointment.proof_image || ''
    };
}

function copySheetRow(row) {
    return Object.fromEntries(HEADERS.map(header => [header, row.get(header) ?? '']));
}

try {
    const groupResult = await pool.query(
        `SELECT telegram_group_id, group_name, bot_role, customer_sheet_id
           FROM telegram_groups
          WHERE telegram_group_id = $1`,
        [GROUP_ID]
    );
    const group = groupResult.rows[0];
    if (!group) throw new Error(`Không tìm thấy nhóm ${GROUP_ID}`);
    if (!group.customer_sheet_id) throw new Error(`Nhóm ${GROUP_ID} chưa có customer_sheet_id`);

    const sourceSheetId = process.env.CUSTOMER_SPREADSHEET_ID;
    if (!sourceSheetId) throw new Error('Thiếu CUSTOMER_SPREADSHEET_ID mặc định');
    if (sourceSheetId === group.customer_sheet_id) throw new Error('Sheet nguồn và đích đang trùng nhau');

    const [sourceDoc, targetDoc] = await Promise.all([
        getDocById(sourceSheetId),
        getDocById(group.customer_sheet_id)
    ]);
    await Promise.all([sourceDoc.loadInfo(), targetDoc.loadInfo()]);

    const masterTitle = group.bot_role === 'report_tour' ? 'TỔNG HỢP TOUR' : 'TỔNG HỢP KHÁCH HÀNG';
    const sourceMaster = sourceDoc.sheetsByTitle[masterTitle];
    if (!sourceMaster) throw new Error(`Sheet nguồn không có tab ${masterTitle}`);
    const targetMaster = await ensureSheet(targetDoc, masterTitle);
    if (!targetMaster && APPLY) throw new Error(`Không tạo được tab đích ${masterTitle}`);

    const appointmentsResult = await pool.query(
        `SELECT a.*, e.employee_code
           FROM customer_appointments a
           LEFT JOIN LATERAL (
               SELECT employee_code
                 FROM employees
                WHERE telegram_id = a.telegram_id
                  AND telegram_group_id = a.group_id
                LIMIT 1
           ) e ON TRUE
          WHERE a.group_id = $1
            AND a.appointment_time >= $2::date
            AND a.appointment_time < $3::date
            AND a.sheet_row_index IS NOT NULL
            AND a.status <> 'CANCELLED'
          ORDER BY a.appointment_time, a.id`,
        [GROUP_ID, FROM_DATE, TO_DATE]
    );

    const sourceRows = await sourceMaster.getRows();
    const targetMasterRows = await loadRows(targetMaster);
    const individualCache = new Map();
    const stats = { candidates: 0, sourceMatched: 0, masterAdded: 0, individualAdded: 0, alreadyPresent: 0, dbIndexesUpdated: 0 };

    for (const appointment of appointmentsResult.rows) {
        stats.candidates += 1;
        const fallbackData = rowDataFromAppointment(appointment);
        const sourceKey = buildCustomerSheetRowKey(fallbackData);
        const sourceRow = sourceRows.find(row => buildCustomerSheetRowKey(row) === sourceKey);
        const rowData = sourceRow ? copySheetRow(sourceRow) : fallbackData;
        if (sourceRow) stats.sourceMatched += 1;

        const masterResult = await addIfMissing(targetMaster, targetMasterRows, rowData);
        if (masterResult.added) stats.masterAdded += 1;

        const individualTitle = `${appointment.employee_name}${group.bot_role === 'report_tour' ? ' [Tour]' : ''}`.substring(0, 100);
        if (!individualCache.has(individualTitle)) {
            const sheet = await ensureSheet(targetDoc, individualTitle);
            individualCache.set(individualTitle, { sheet, rows: await loadRows(sheet) });
        }
        const individual = individualCache.get(individualTitle);
        const individualResult = await addIfMissing(individual.sheet, individual.rows, rowData);
        if (individualResult.added) stats.individualAdded += 1;
        if (!masterResult.added && !individualResult.added) stats.alreadyPresent += 1;

        if (APPLY && individualResult.row?.rowNumber) {
            await pool.query(
                'UPDATE customer_appointments SET sheet_row_index = $1 WHERE id = $2',
                [individualResult.row.rowNumber, appointment.id]
            );
            stats.dbIndexesUpdated += 1;
        }
    }

    console.log(JSON.stringify({
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        group: group.group_name,
        source: { id: sourceSheetId, title: sourceDoc.title },
        target: { id: group.customer_sheet_id, title: targetDoc.title },
        range: { from: FROM_DATE, toExclusive: TO_DATE },
        stats
    }, null, 2));
} finally {
    await pool.end();
}
