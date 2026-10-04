/**
 * Đồng bộ báo cáo Telesale sang Google Sheets.
 *
 * Ghi vào 2 nơi trong file Spreadsheet:
 * 1. Tab "TỔNG HỢP": Toàn bộ lượt nộp của cả team.
 * 2. Tab "[Tên Nhân Sự]": Tab cá nhân của từng nhân viên theo ngày.
 */

import { isExcludedSheetEmployee } from '../../../../packages/shared/excluded-employees.js';
import { formatFieldValue } from '../../domain/safe-formula-engine.js';

const DEFAULT_SPREADSHEET_ID = '1gQYXoylEysKKqUpYMxAzLw1nA7KC89eC-FO4kSzhlYU';
const MASTER_TAB_NAME = 'TỔNG HỢP';
const PENALTY_TAB_NAME = 'SỔ PHẠT TELESALE';


export const TELESALE_SHEET_HEADERS = [
    'Ngày',
    'Thời gian nộp',
    'Nhân sự',
    'Số nhận',
    'Số trùng / KNC / Văng',
    'Số lịch PV mới',
    'Số lịch PV cũ',
    'Tổng lịch',
    'Lịch hẹn ngày mai',
    'Tổng tới hôm nay',
    'Tổng bong hôm nay',
    'TỔNG DS hnay',
    'Tổng DS cộng dồn tháng',
    'Tỷ lệ khách tới / doanh số',
    'Tỷ lệ lịch (%)',
    'Tỉ lệ tới (%)',
    'Đánh giá',
    'Chi tiết dịch vụ'
];

export const TELESALE_PENALTY_HEADERS = [
    'STT',
    'Ngày vi phạm',
    'Họ và tên',
    'Loại vi phạm',
    'Số tiền phạt (VNĐ)',
    'Lý do vi phạm',
    'Thời gian ghi nhận',
    'Trạng thái',
    'Ghi chú'
];

function sanitizeTabTitle(name) {
    if (!name) return 'Nhân viên';
    let clean = String(name).replace(/[\\/?*:[\]]/g, '_').trim();
    clean = clean.replace(/^'+|'+$/g, '');
    if (clean.length > 100) clean = clean.substring(0, 100);
    return clean || 'Nhân viên';
}

export function createTelesaleSheetSync({ getDocById }) {
    async function ensureSheetWithHeaders(doc, tabName) {
        let sheet = doc.sheetsByTitle[tabName];
        if (!sheet) {
            // Nếu là MASTER_TAB_NAME và sheet đầu tiên có tên mặc định 'Trang tính1'
            if (tabName === MASTER_TAB_NAME && doc.sheetCount === 1) {
                const firstSheet = doc.sheetsByIndex[0];
                if (firstSheet.title === 'Trang tính1' || firstSheet.title === 'Sheet1') {
                    try {
                        await firstSheet.updateProperties({ title: MASTER_TAB_NAME });
                        await firstSheet.setHeaderRow(TELESALE_SHEET_HEADERS);
                        return firstSheet;
                    } catch (_) {}
                }
            }
            sheet = await doc.addSheet({ headerValues: TELESALE_SHEET_HEADERS, title: tabName });
        } else {
            try {
                await sheet.loadHeaderRow();
                if (!sheet.headerValues || sheet.headerValues.length === 0) {
                    await sheet.setHeaderRow(TELESALE_SHEET_HEADERS);
                }
            } catch (_) {
                await sheet.setHeaderRow(TELESALE_SHEET_HEADERS).catch(() => {});
            }
        }
        return sheet;
    }

    async function upsertRowByDate(sheet, rowData, dateStr, matchEmployee = false, employeeName = '') {
        try {
            const rows = await sheet.getRows();
            let targetRow = null;

            for (const r of rows) {
                const rDate = r.get('Ngày');
                if (rDate === dateStr) {
                    if (matchEmployee) {
                        if (r.get('Nhân sự') === employeeName) {
                            targetRow = r;
                            break;
                        }
                    } else {
                        targetRow = r;
                        break;
                    }
                }
            }

            if (targetRow) {
                targetRow.assign(rowData);
                await targetRow.save();
                return;
            }

            await sheet.addRow(rowData);
        } catch (err) {
            console.error('[Telesale Sheet] Lỗi ghi dòng:', err.message || err);
            // Cố gắng append nếu ghi đè thất bại
            await sheet.addRow(rowData).catch(() => {});
        }
    }

    /**
     * Đồng bộ một bản báo cáo ngày vào Google Sheet.
     */
    async function syncDailyReport({
        spreadsheetId,
        dateStr,
        timeStr,
        employeeName,
        stats,
        fields = null
    }) {
        if (isExcludedSheetEmployee(employeeName)) {
            console.log(`[Telesale Sheet] Bỏ qua ghi Sheet cho nhân sự loại trừ: ${employeeName}`);
            const targetSheetId = spreadsheetId || DEFAULT_SPREADSHEET_ID;
            return `https://docs.google.com/spreadsheets/d/${targetSheetId}`;
        }

        const targetSheetId = spreadsheetId || DEFAULT_SPREADSHEET_ID;

        try {
            const doc = await getDocById(targetSheetId);
            if (!doc) {
                console.warn(`[Telesale Sheet Warning] Không thể kết nối Google Spreadsheet: ${targetSheetId}`);
                return null;
            }
            await doc.loadInfo();

            let danhGia = 'Đạt chuẩn';
            if (stats.isToiReward) {
                danhGia = 'Khen thưởng (Tỉ lệ tới > 19%)';
            } else if (stats.isToiWarning && stats.isLichWarning) {
                danhGia = 'Cảnh báo: Tới < 15% & Lịch < 25%';
            } else if (stats.isToiWarning) {
                danhGia = 'Cảnh báo: Tỉ lệ tới < 15%';
            } else if (stats.isLichWarning) {
                danhGia = 'Cảnh báo: Tỷ lệ lịch < 25%';
            }

            const rowData = {
                'Ngày': dateStr,
                'Thời gian nộp': timeStr,
                'Nhân sự': employeeName
            };

            if (fields && Array.isArray(fields) && fields.length > 0) {
                const activeFields = fields.filter(f => !f.is_hidden).sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
                for (const f of activeFields) {
                    const rawVal = stats[f.key] ?? stats.values?.[f.key] ?? 0;
                    if (f.type === 'currency') {
                        rowData[f.label] = formatFieldValue(rawVal, 'currency');
                    } else if (f.type === 'percentage') {
                        rowData[f.label] = formatFieldValue(rawVal, 'percentage');
                    } else {
                        rowData[f.label] = rawVal;
                    }
                }
            } else {
                rowData['Số nhận'] = stats.so_nhan;
                rowData['Số trùng / KNC / Văng'] = stats.so_trung_knc_vang;
                rowData['Số lịch PV mới'] = stats.lich_pv_moi;
                rowData['Số lịch PV cũ'] = stats.lich_pv_cu;
                rowData['Tổng lịch'] = stats.tong_lich;
                rowData['Lịch hẹn ngày mai'] = stats.lich_ngay_mai;
                rowData['Tổng tới hôm nay'] = stats.tong_toi_hnay;
                rowData['Tổng bong hôm nay'] = stats.tong_bong_hnay;
                rowData['TỔNG DS hnay'] = stats.tong_ds_hnay;
                rowData['Tổng DS cộng dồn tháng'] = stats.tong_ds_thang;
                rowData['Tỷ lệ khách tới / doanh số'] = stats.ty_le_khach_toi_ds;
                rowData['Tỷ lệ lịch (%)'] = `${stats.ty_le_lich}%`;
                rowData['Tỉ lệ tới (%)'] = `${stats.ty_le_toi}%`;
            }

            rowData['Đánh giá'] = danhGia;
            rowData['Chi tiết dịch vụ'] = stats.services && stats.services.length > 0
                ? stats.services.map(s => `${s.service_name}: ${s.lich} lịch, ${s.toi} tới, ${s.ds}đ`).join('; ')
                : '';

            // 1. Ghi vào Sheet Tổng Hợp
            const masterSheet = await ensureSheetWithHeaders(doc, MASTER_TAB_NAME);
            if (masterSheet) {
                await upsertRowByDate(masterSheet, rowData, dateStr, true, employeeName);
            }

            // 2. Ghi vào Sheet cá nhân của nhân sự
            const memberTabName = sanitizeTabTitle(employeeName);
            const memberSheet = await ensureSheetWithHeaders(doc, memberTabName);
            if (memberSheet && memberSheet.sheetId !== masterSheet?.sheetId) {
                await upsertRowByDate(memberSheet, rowData, dateStr, false);
            }

            const sheetUrl = `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`;
            console.log(`[Telesale Sheet] Đã đồng bộ thành công báo cáo cho ${employeeName} ngày ${dateStr} lên Google Sheets.`);
            return sheetUrl;
        } catch (error) {
            console.error('[Telesale Sheet Error] Lỗi khi đồng bộ lên Google Sheet:', error.message || error);
            return `https://docs.google.com/spreadsheets/d/${targetSheetId}/edit`;
        }
    }

    /**
     * Đồng bộ bản ghi phạt vi phạm Telesale vào Tab 'SỔ PHẠT TELESALE'.
     */
    async function syncPenalty({
        spreadsheetId,
        dateStr,
        employeeName,
        penaltyAmount = 50000,
        reason = 'Chậm nộp báo cáo Telesale sau 19:00',
        recordedTimeStr = ''
    }) {
        if (isExcludedSheetEmployee(employeeName)) {
            console.log(`[Telesale Penalty Sheet] Bỏ qua phạt trên Sheet cho nhân sự loại trừ: ${employeeName}`);
            return null;
        }

        const targetSheetId = spreadsheetId || DEFAULT_SPREADSHEET_ID;

        try {
            const doc = await getDocById(targetSheetId);
            if (!doc) return null;
            await doc.loadInfo();

            let sheet = doc.sheetsByTitle[PENALTY_TAB_NAME];
            if (!sheet) {
                sheet = await doc.addSheet({
                    title: PENALTY_TAB_NAME,
                    headerValues: TELESALE_PENALTY_HEADERS
                });
                try {
                    await sheet.loadCells('A1:I1');
                    for (let col = 0; col < TELESALE_PENALTY_HEADERS.length; col++) {
                        const cell = sheet.getCell(0, col);
                        cell.textFormat = { bold: true };
                        cell.backgroundColor = { red: 1.0, green: 0.9, blue: 0.6 };
                    }
                    await sheet.saveUpdatedCells();
                } catch (_) {}
            }

            const rows = await sheet.getRows();
            let targetRow = null;
            for (const r of rows) {
                if (r.get('Ngày vi phạm') === dateStr && r.get('Họ và tên') === employeeName) {
                    targetRow = r;
                    break;
                }
            }

            const rowData = {
                'STT': targetRow ? targetRow.get('STT') : rows.length + 1,
                'Ngày vi phạm': dateStr,
                'Họ và tên': employeeName,
                'Loại vi phạm': 'Quá hạn báo cáo sau 19:00',
                'Số tiền phạt (VNĐ)': Number(penaltyAmount).toLocaleString('vi-VN') + ' đ',
                'Lý do vi phạm': reason,
                'Thời gian ghi nhận': recordedTimeStr || `${dateStr} 19:00:00`,
                'Trạng thái': 'Chưa nộp',
                'Ghi chú': ''
            };

            if (targetRow) {
                targetRow.assign(rowData);
                await targetRow.save();
            } else {
                await sheet.addRow(rowData);
            }

            console.log(`[Telesale Penalty Sheet] Đã đồng bộ phạt cho ${employeeName} ngày ${dateStr}.`);
        } catch (err) {
            console.error('[Telesale Penalty Sheet Error]:', err.message || err);
        }
    }

    /**
     * Đồng bộ lại dòng tiêu đề (Header row) trên Google Sheet theo danh sách trường của nhóm.
     */
    async function syncGroupHeaders({ spreadsheetId, fields = [] }) {
        const targetSheetId = spreadsheetId || DEFAULT_SPREADSHEET_ID;
        const doc = await getDocById(targetSheetId);
        if (!doc) {
            throw new Error(`Không thể kết nối Google Spreadsheet: ${targetSheetId}`);
        }
        await doc.loadInfo();

        const activeFields = (fields || [])
            .filter(f => !f.is_hidden)
            .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

        const dynamicHeaders = [
            'Ngày',
            'Thời gian nộp',
            'Nhân sự',
            ...activeFields.map(f => f.label),
            'Đánh giá',
            'Chi tiết dịch vụ'
        ];

        let masterSheet = doc.sheetsByTitle[MASTER_TAB_NAME];
        if (!masterSheet) {
            masterSheet = await doc.addSheet({ headerValues: dynamicHeaders, title: MASTER_TAB_NAME });
        } else {
            await masterSheet.setHeaderRow(dynamicHeaders);
        }

        return {
            success: true,
            tabName: MASTER_TAB_NAME,
            headers: dynamicHeaders,
            sheetUrl: `https://docs.google.com/spreadsheets/d/${targetSheetId}`
        };
    }

    return {
        syncDailyReport,
        syncPenalty,
        syncGroupHeaders
    };
}
