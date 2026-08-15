import 'dotenv/config';
import pool from '../packages/database/index.js';
import { getDocById } from '../apps/bot/sheetManager.js';

const GROUP_ID = process.env.BACKFILL_KPI_GROUP_ID || '-1002148193072';
const TARGET_SHEET_ID = process.env.BACKFILL_KPI_TARGET_ID || '1feLDW45jL8_WLlqoTzsYDtW-trKtgF5XJkreLPxYYbE';
const FROM_DATE = process.env.BACKFILL_KPI_FROM_DATE || '2026-08-01';
const localToday = new Date();
const defaultToDate = `${localToday.getFullYear()}-${String(localToday.getMonth() + 1).padStart(2, '0')}-${String(localToday.getDate() + 1).padStart(2, '0')}`;
const TO_DATE = process.env.BACKFILL_KPI_TO_DATE || defaultToDate;
const APPLY = process.argv.includes('--apply');

const KPI_HEADERS = [
    'Ngày', 'Nhân viên', 'Mã NV', 'Telegram ID', 'Số tin nhắn (KPI)',
    'Tin nhắn Thực tế', 'Doanh Thu', 'Lịch Khách', 'Hoàn thành (%)',
    'Trạng thái', 'Tình trạng Ảnh', 'Nội dung tin nhắn'
];
const PENALTY_HEADERS = ['Nhân viên', 'Mã NV', 'Telegram ID', 'Tổng Tiền Phạt', 'Lịch Sử Vi Phạm'];

function normalize(value) {
    return String(value ?? '').trim().toLocaleLowerCase('vi-VN');
}

function kpiRowKey(row) {
    const get = typeof row?.get === 'function' ? header => row.get(header) : header => row?.[header];
    return [
        get('Ngày'),
        get('Telegram ID'),
        get('Tin nhắn Thực tế'),
        get('Nội dung tin nhắn')
    ].map(normalize).join('|');
}

function parseSheetDate(value) {
    const text = String(value ?? '').trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!match) return null;
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function copyRow(row, headers) {
    return Object.fromEntries(headers.map(header => [header, row.get(header) ?? '']));
}

async function addRowsIdempotently(targetSheet, sourceRows, headers, keyBuilder) {
    const targetRows = targetSheet ? await targetSheet.getRows() : [];
    const existingKeys = new Set(targetRows.map(keyBuilder));
    let added = 0;
    let existing = 0;

    for (const sourceRow of sourceRows) {
        const rowData = copyRow(sourceRow, headers);
        const key = keyBuilder(rowData);
        if (existingKeys.has(key)) {
            existing += 1;
            continue;
        }
        if (APPLY) {
            await targetSheet.addRow(rowData);
            existingKeys.add(key);
        }
        added += 1;
    }
    return { added, existing };
}

try {
    const groupResult = await pool.query(
        `SELECT telegram_group_id, group_name, bot_role, kpi_sheet_id
           FROM telegram_groups WHERE telegram_group_id = $1`,
        [GROUP_ID]
    );
    const group = groupResult.rows[0];
    if (!group) throw new Error(`Không tìm thấy nhóm ${GROUP_ID}`);

    const sourceSheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!sourceSheetId) throw new Error('Thiếu GOOGLE_SPREADSHEET_ID mặc định');
    if (sourceSheetId === TARGET_SHEET_ID) throw new Error('Sheet KPI nguồn và đích đang trùng nhau');

    const employeesResult = await pool.query(
        `SELECT DISTINCT e.telegram_id, e.full_name, e.employee_code
           FROM daily_reports dr
           JOIN employees e ON e.id = dr.employee_id
          WHERE dr.telegram_group_id = $1
            AND dr.report_date >= $2::date
            AND dr.report_date < $3::date
          ORDER BY e.full_name`,
        [GROUP_ID, FROM_DATE, TO_DATE]
    );
    const employees = employeesResult.rows;
    const telegramIds = new Set(employees.map(employee => String(employee.telegram_id)));
    if (telegramIds.size === 0) throw new Error('Không tìm thấy nhân viên có báo cáo KPI trong khoảng phục hồi');

    const [sourceDoc, targetDoc] = await Promise.all([
        getDocById(sourceSheetId),
        getDocById(TARGET_SHEET_ID)
    ]);
    await Promise.all([sourceDoc.loadInfo(), targetDoc.loadInfo()]);

    const sourceMain = sourceDoc.sheetsByIndex[0];
    const targetMain = targetDoc.sheetsByIndex[0];
    if (!sourceMain || !targetMain) throw new Error('Không tìm thấy tab KPI tổng ở nguồn hoặc đích');

    const sourceMainRows = await sourceMain.getRows();
    const filteredMainRows = sourceMainRows.filter(row => {
        const telegramId = String(row.get('Telegram ID') ?? '').trim();
        const reportDate = parseSheetDate(row.get('Ngày'));
        return telegramIds.has(telegramId)
            && reportDate
            && reportDate >= FROM_DATE
            && reportDate < TO_DATE;
    });

    const mainStats = await addRowsIdempotently(targetMain, filteredMainRows, KPI_HEADERS, kpiRowKey);
    const individualStats = {};

    for (const employee of employees) {
        const suffix = String(employee.telegram_id).slice(-3);
        const title = `${employee.full_name} - ${suffix}`.substring(0, 100);
        const sourceSheet = sourceDoc.sheetsByTitle[title];
        let targetSheet = targetDoc.sheetsByTitle[title];
        if (!sourceSheet) {
            individualStats[title] = { sourceMissing: true, added: 0, existing: 0 };
            continue;
        }
        if (!targetSheet && APPLY) {
            targetSheet = await targetDoc.addSheet({ title, headerValues: KPI_HEADERS });
        }
        const sourceRows = (await sourceSheet.getRows()).filter(row => {
            const reportDate = parseSheetDate(row.get('Ngày'));
            return reportDate && reportDate >= FROM_DATE && reportDate < TO_DATE;
        });
        individualStats[title] = targetSheet
            ? await addRowsIdempotently(targetSheet, sourceRows, KPI_HEADERS, kpiRowKey)
            : { added: sourceRows.length, existing: 0 };
    }

    const monthNumber = Number(FROM_DATE.slice(5, 7));
    const year = FROM_DATE.slice(0, 4);
    const penaltyTitle = `TỔNG PHẠT T${monthNumber}-${year}`;
    const sourcePenalty = sourceDoc.sheetsByTitle[penaltyTitle];
    let penaltyStats = { sourceMissing: true, added: 0, existing: 0 };
    if (sourcePenalty) {
        let targetPenalty = targetDoc.sheetsByTitle[penaltyTitle];
        if (!targetPenalty && APPLY) {
            targetPenalty = await targetDoc.addSheet({ title: penaltyTitle, headerValues: PENALTY_HEADERS });
        }
        const penaltyRows = (await sourcePenalty.getRows()).filter(row =>
            telegramIds.has(String(row.get('Telegram ID') ?? '').trim())
        );
        const penaltyKey = row => normalize(typeof row?.get === 'function' ? row.get('Telegram ID') : row?.['Telegram ID']);
        penaltyStats = targetPenalty
            ? await addRowsIdempotently(targetPenalty, penaltyRows, PENALTY_HEADERS, penaltyKey)
            : { sourceMissing: false, added: penaltyRows.length, existing: 0 };
    }

    if (APPLY) {
        await pool.query(
            `UPDATE telegram_groups SET kpi_sheet_id = $1 WHERE telegram_group_id = $2`,
            [TARGET_SHEET_ID, GROUP_ID]
        );
    }

    console.log(JSON.stringify({
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        group: { id: GROUP_ID, name: group.group_name, previousKpiSheetId: group.kpi_sheet_id },
        configuration: { targetKpiSheetId: TARGET_SHEET_ID, updated: APPLY },
        source: { id: sourceSheetId, title: sourceDoc.title },
        target: { id: TARGET_SHEET_ID, title: targetDoc.title },
        range: { from: FROM_DATE, toExclusive: TO_DATE },
        employees,
        main: { candidates: filteredMainRows.length, ...mainStats },
        individuals: individualStats,
        penalties: { title: penaltyTitle, ...penaltyStats }
    }, null, 2));
} finally {
    await pool.end();
}
