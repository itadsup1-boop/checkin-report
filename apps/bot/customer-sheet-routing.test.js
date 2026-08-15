import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCustomerSheetRowKey,
    findCustomerSheetRow,
    resolveCustomerSpreadsheetId,
    resolveKpiSpreadsheetId
} from './customer-sheet-routing.js';

const env = {
    CUSTOMER_SPREADSHEET_ID: 'customer-default',
    TOUR_SPREADSHEET_ID: 'tour-default'
};

test('ưu tiên customer_sheet_id được cấu hình riêng cho nhóm', () => {
    assert.equal(
        resolveCustomerSpreadsheetId({ bot_role: 'report', customer_sheet_id: ' group-sheet ' }, env),
        'group-sheet'
    );
});

test('nhóm report chưa có ID dùng Sheet khách mặc định', () => {
    assert.equal(
        resolveCustomerSpreadsheetId({ bot_role: 'report', customer_sheet_id: null }, env),
        'customer-default'
    );
});

test('nhóm report_tour chưa có ID dùng Sheet tour mặc định', () => {
    assert.equal(
        resolveCustomerSpreadsheetId({ bot_role: 'report_tour', customer_sheet_id: null }, env),
        'tour-default'
    );
});

test('KPI ưu tiên kpi_sheet_id riêng của nhóm', () => {
    assert.equal(
        resolveKpiSpreadsheetId({ kpi_sheet_id: ' meditech-kpi ' }, { GOOGLE_SPREADSHEET_ID: 'kpi-default' }),
        'meditech-kpi'
    );
});

test('KPI chưa có ID riêng dùng Sheet KPI mặc định', () => {
    assert.equal(
        resolveKpiSpreadsheetId({ kpi_sheet_id: null }, { GOOGLE_SPREADSHEET_ID: 'kpi-default' }),
        'kpi-default'
    );
});

test('khóa chống trùng ổn định giữa dữ liệu ghi và dòng Google Sheet', () => {
    const data = {
        'Nhân Viên': 'Trần Phương Hoa',
        'Khách Hàng': ' Võ Thị Bé ',
        'SĐT': '098316',
        'Thời Gian': '10:00 13/08/2026'
    };
    const sheetRow = {
        get(header) {
            return {
                'Nhân Viên': ' trần phương hoa ',
                'Khách Hàng': 'Võ Thị Bé',
                'SĐT': 98316,
                'Thời Gian': '10:00 13/08/2026'
            }[header];
        }
    };

    assert.equal(buildCustomerSheetRowKey(data), buildCustomerSheetRowKey(sheetRow));
});

test('không dùng nhầm row index cũ nếu dòng đó thuộc khách khác', () => {
    const makeRow = (rowNumber, employee, customer, phone, time) => ({
        rowNumber,
        get(header) {
            return {
                'Nhân Viên': employee,
                'Khách Hàng': customer,
                'SĐT': phone,
                'Thời Gian': time
            }[header];
        }
    });
    const wrongIndexedRow = makeRow(20, 'Ngọc', 'Khách khác', '1111', '09:00 01/08/2026');
    const correctRow = makeRow(35, 'Hoa', 'Khách đúng', '2222', '10:00 02/08/2026');
    const expected = {
        'Nhân Viên': 'Hoa',
        'Khách Hàng': 'Khách đúng',
        'SĐT': '2222',
        'Thời Gian': '10:00 02/08/2026'
    };

    assert.equal(findCustomerSheetRow([wrongIndexedRow, correctRow], expected, 20), correctRow);
});
