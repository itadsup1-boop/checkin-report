/**
 * So khớp một dòng Google Sheet với dữ liệu lịch khách/báo bù.
 *
 * Sheet không có khoá ngoại tới `customer_appointments`, nên phải tự dựng khoá
 * từ các cột nghiệp vụ (nhân viên + khách + SĐT + giờ hẹn) để tìm đúng dòng cần
 * cập nhật thay vì luôn thêm dòng mới — tránh một khách bị ghi trùng nhiều lần
 * khi đồng bộ lại (mạng lỗi, retry cron).
 *
 * Thuần — không pg/express/telegraf/google-spreadsheet.
 */

function normalizeKeyPart(value) {
    return String(value ?? '').trim().toLocaleLowerCase('vi-VN');
}

function normalizePhoneKey(value) {
    const normalized = normalizeKeyPart(value).replace(/\D/g, '');
    return normalized.replace(/^0+(?=\d)/, '');
}

export function buildCustomerSheetRowKey(source) {
    const get = typeof source?.get === 'function'
        ? header => source.get(header)
        : header => source?.[header];

    return [
        normalizeKeyPart(get('Nhân Viên')),
        normalizeKeyPart(get('Khách Hàng')),
        normalizePhoneKey(get('SĐT')),
        normalizeKeyPart(get('Thời Gian'))
    ].join('|');
}

export function findCustomerSheetRow(rows, rowData, rowIndex) {
    const expectedKey = buildCustomerSheetRowKey(rowData);
    if (rowIndex) {
        const indexedRow = rows.find(row => row.rowNumber === Number(rowIndex));
        if (indexedRow && buildCustomerSheetRowKey(indexedRow) === expectedKey) {
            return indexedRow;
        }
    }
    return rows.find(row => buildCustomerSheetRowKey(row) === expectedKey) || null;
}
