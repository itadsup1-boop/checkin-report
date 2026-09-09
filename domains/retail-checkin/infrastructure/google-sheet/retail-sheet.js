/**
 * Đồng bộ dữ liệu check-in điểm bán thị trường sang Google Sheets của nhóm.
 */

const MASTER_SHEET_TITLE = 'TỔNG HỢP';
const LEGACY_SHEET_TITLE = 'CHECK-IN TUYẾN ĐIỂM BÁN';

export const HEADERS = [
    'Ngày',
    'Thời gian',
    'Nhân viên',
    'Điểm bán',
    'Địa chỉ chi tiết',
    'Tiến độ trong ngày',
    'Ảnh Selfie cổng',
    'Ảnh Quầy kệ sản phẩm',
    'Định vị GPS',
    'Trạng thái'
];

function sanitizeSheetTitle(name) {
    if (!name) return 'Nhân viên';
    let clean = String(name).replace(/[\\/?*:[\]]/g, '_').trim();
    clean = clean.replace(/^'+|'+$/g, '');
    if (clean.length > 100) clean = clean.substring(0, 100);
    return clean || 'Nhân viên';
}

export function formatLocationCell(latitude, longitude, googleMapsUrl, locationAccuracy, locale = 'vi_VN') {
    if ((latitude === null || latitude === undefined || longitude === null || longitude === undefined) && !googleMapsUrl) {
        return '';
    }
    const url = googleMapsUrl || `https://maps.google.com/?q=${latitude},${longitude}`;
    const sep = (locale && locale.startsWith('en')) ? ',' : ';';
    const accText = locationAccuracy ? ` (±${Math.round(locationAccuracy)}m)` : '';
    return `=HYPERLINK("${url}"${sep} "📍 Xem vị trí${accText}")`;
}

function formatPhotoCell(val, defaultLabel = 'Xem ảnh', locale = 'vi_VN') {
    if (!val) return '';
    const parts = String(val).split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    const sep = (locale && locale.startsWith('en')) ? ',' : ';';
    if (parts.length === 1) {
        return parts[0].startsWith('http') ? `=HYPERLINK("${parts[0]}"${sep} "${defaultLabel}")` : parts[0];
    }
    const allHttp = parts.every(p => p.startsWith('http'));
    if (allHttp) {
        return parts.join('\n');
    }
    return parts.join(', ');
}

export async function ensureGpsHeader(sheet) {
    try {
        await sheet.loadHeaderRow();
        if (sheet.headerValues && !sheet.headerValues.includes('Định vị GPS')) {
            const newHeaders = [...sheet.headerValues];
            const statusIdx = newHeaders.indexOf('Trạng thái');
            if (statusIdx !== -1) {
                newHeaders.splice(statusIdx, 0, 'Định vị GPS');
            } else {
                newHeaders.push('Định vị GPS');
            }
            await sheet.setHeaderRow(newHeaders);
        }
    } catch (_) {}
}

export function createRetailSheetSync({ getDocForGroup }) {
    async function syncCheckin(telegramGroupId, data) {
        try {
            const doc = await getDocForGroup(telegramGroupId);
            if (!doc) {
                console.warn(`[Retail Sheet Warning] Không tìm thấy Google Spreadsheet cho nhóm ${telegramGroupId}`);
                return;
            }
            await doc.loadInfo();

            const locale = doc.locale || 'vi_VN';

            const rowData = {
                'Ngày': data.dateStr,
                'Thời gian': data.timeStr,
                'Nhân viên': data.employeeName,
                'Điểm bán': data.storeName,
                'Địa chỉ chi tiết': data.storeAddress,
                'Tiến độ trong ngày': data.progressStr,
                'Ảnh Selfie cổng': formatPhotoCell(data.selfieUrl, 'Ảnh cổng', locale),
                'Ảnh Quầy kệ sản phẩm': formatPhotoCell(data.storePhotoUrl, 'Ảnh quầy', locale),
                'Định vị GPS': formatLocationCell(data.latitude, data.longitude, data.googleMapsUrl, data.locationAccuracy, locale),
                'Trạng thái': data.isValid ? (data.isOvertime ? 'Hợp lệ (Ngoài giờ)' : 'Hợp lệ') : `Không hợp lệ (${data.rejectReason || ''})`
            };

            // 1. Đồng bộ vào Sheet Tổng (TỔNG HỢP)
            let masterSheet = doc.sheetsByTitle[MASTER_SHEET_TITLE] || doc.sheetsByTitle[LEGACY_SHEET_TITLE];
            if (!masterSheet) {
                masterSheet = await doc.addSheet({ headerValues: HEADERS, title: MASTER_SHEET_TITLE });
            } else {
                if (masterSheet.title === LEGACY_SHEET_TITLE) {
                    try {
                        await masterSheet.updateProperties({ title: MASTER_SHEET_TITLE });
                    } catch (_) {}
                }
                await ensureGpsHeader(masterSheet);
            }
            await masterSheet.addRow(rowData);

            // 2. Đồng bộ vào Sheet riêng của từng nhân viên
            const empTabName = sanitizeSheetTitle(data.employeeName);
            let empSheet = doc.sheetsByTitle[empTabName];
            if (!empSheet) {
                empSheet = await doc.addSheet({ headerValues: HEADERS, title: empTabName });
            } else {
                await ensureGpsHeader(empSheet);
            }
            if (empSheet && empSheet.sheetId !== masterSheet.sheetId) {
                await empSheet.addRow(rowData);
            }

            console.log(`[Retail Sheet] Đồng bộ thành công điểm bán ${data.storeName} (${data.employeeName}) lên Sheet Tổng và Sheet cá nhân "${empTabName}".`);
        } catch (error) {
            console.error('[Retail Sheet Error] Lỗi khi đồng bộ lên Google Sheet:', error.message || error);
        }
    }

    const CLOSING_SHEET_TITLE = 'TỔNG KẾT KPI NGÀY';
    const CLOSING_HEADERS = [
        'Ngày chốt',
        'Nhân viên',
        'Số điểm đã gửi',
        'Chỉ tiêu KPI',
        'Số điểm thiếu',
        'Kết quả',
        'Trạng thái chốt sổ'
    ];

    async function syncDailyClosing(telegramGroupId, { dateStr, closingList = [], targetPoints = 15 }) {
        try {
            const doc = await getDocForGroup(telegramGroupId);
            if (!doc) {
                console.warn(`[Retail Sheet Warning] Không tìm thấy Google Spreadsheet cho nhóm ${telegramGroupId}`);
                return;
            }
            await doc.loadInfo();

            // 1. Cập nhật bảng tổng hợp chốt sổ TỔNG KẾT KPI NGÀY
            let closingSheet = doc.sheetsByTitle[CLOSING_SHEET_TITLE];
            if (!closingSheet) {
                closingSheet = await doc.addSheet({ headerValues: CLOSING_HEADERS, title: CLOSING_SHEET_TITLE });
            }

            const closingRows = await closingSheet.getRows();

            for (const item of closingList) {
                const missing = Math.max(0, targetPoints - item.validPoints);
                const isCompleted = item.validPoints >= targetPoints;
                const ketQua = isCompleted ? 'GỬI ĐỦ' : 'THIẾU';
                const trangThai = isCompleted ? 'ĐẠT (Hoàn thành 100%)' : `CHƯA ĐẠT (Thiếu ${missing} điểm) - Chốt 20:00`;

                const closingRowData = {
                    'Ngày chốt': dateStr,
                    'Nhân viên': item.employeeName,
                    'Số điểm đã gửi': item.validPoints,
                    'Chỉ tiêu KPI': targetPoints,
                    'Số điểm thiếu': missing,
                    'Kết quả': ketQua,
                    'Trạng thái chốt sổ': trangThai
                };

                // Tìm xem đã có dòng chốt sổ của nhân viên này trong ngày hôm nay chưa
                const existingRow = closingRows.find(
                    r => r.get('Ngày chốt') === dateStr && r.get('Nhân viên') === item.employeeName
                );

                if (existingRow) {
                    Object.entries(closingRowData).forEach(([k, v]) => existingRow.set(k, v));
                    await existingRow.save();
                } else {
                    await closingSheet.addRow(closingRowData);
                }

                // 2. Ghi thêm dòng chốt sổ 20:00 vào Sheet riêng của nhân viên đó
                const empTabName = sanitizeSheetTitle(item.employeeName);
                let empSheet = doc.sheetsByTitle[empTabName];
                if (!empSheet) {
                    empSheet = await doc.addSheet({ headerValues: HEADERS, title: empTabName });
                }

                if (empSheet && empSheet.sheetId !== closingSheet.sheetId) {
                    const empRows = await empSheet.getRows();
                    const existingEmpClosing = empRows.find(
                        r => r.get('Ngày') === dateStr && r.get('Điểm bán') === '--- CHỐT SỔ KPI 20:00 ---'
                    );

                    const empClosingData = {
                        'Ngày': dateStr,
                        'Thời gian': '20:00:00',
                        'Nhân viên': item.employeeName,
                        'Điểm bán': '--- CHỐT SỔ KPI 20:00 ---',
                        'Địa chỉ chi tiết': isCompleted ? 'Hoàn thành chỉ tiêu KPI ngày' : `Chưa hoàn thành chỉ tiêu (Thiếu ${missing} điểm)`,
                        'Tiến độ trong ngày': `${item.validPoints}/${targetPoints}`,
                        'Ảnh Selfie cổng': '',
                        'Ảnh Quầy kệ sản phẩm': '',
                        'Trạng thái': isCompleted ? 'GỬI ĐỦ (ĐẠT)' : `THIẾU (Thiếu ${missing} điểm)`
                    };

                    if (existingEmpClosing) {
                        Object.entries(empClosingData).forEach(([k, v]) => existingEmpClosing.set(k, v));
                        await existingEmpClosing.save();
                    } else {
                        await empSheet.addRow(empClosingData);
                    }
                }
            }

            console.log(`[Retail Sheet] Đã chốt sổ và ghi nhận trạng thái GỬI ĐỦ / THIẾU cho ${closingList.length} nhân sự lên Google Sheet nhóm ${telegramGroupId}.`);
        } catch (error) {
            console.error('[Retail Sheet Error] Lỗi khi ghi nhận chốt sổ lên Google Sheet:', error.message || error);
        }
    }

    return {
        syncCheckin,
        syncDailyClosing,
        SHEET_TITLE: MASTER_SHEET_TITLE,
        CLOSING_SHEET_TITLE,
        HEADERS,
        CLOSING_HEADERS
    };
}
