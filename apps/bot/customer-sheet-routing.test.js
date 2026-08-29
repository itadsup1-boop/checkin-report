import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
