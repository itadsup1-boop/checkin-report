export function resolveCustomerSpreadsheetId(groupSettings, env = process.env) {
    if (groupSettings?.customer_sheet_id) {
        return String(groupSettings.customer_sheet_id).trim();
    }

    if (groupSettings?.bot_role === 'report_tour') {
        return env.TOUR_SPREADSHEET_ID || null;
    }

    return env.CUSTOMER_SPREADSHEET_ID || null;
}

export function resolveKpiSpreadsheetId(groupSettings, env = process.env) {
    if (groupSettings?.kpi_sheet_id) {
        return String(groupSettings.kpi_sheet_id).trim();
    }
    return env.GOOGLE_SPREADSHEET_ID || null;
}

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
