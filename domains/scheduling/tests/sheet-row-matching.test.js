import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerSheetRowKey, findCustomerSheetRow } from '../domain/sheet-row-matching.js';

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

test('writeAppointmentRow tự động điền Loại khách là Khách cũ và chuẩn hoá header', async () => {
    const { createAppointmentSheetSync } = await import('../infrastructure/google-sheet/appointment-sheet-sync.js');
    let savedMasterData = null;
    let setHeaders = null;
    const mockSheet = {
        getRows: async () => [],
        setHeaderRow: async headers => { setHeaders = headers; },
        addRow: async data => {
            savedMasterData = data;
            return { rowNumber: 10 };
        }
    };
    const mockDoc = {
        loadInfo: async () => {},
        sheetsByTitle: {
            'TỔNG HỢP KHÁCH HÀNG': mockSheet,
            'NV A': mockSheet
        }
    };
    const sync = createAppointmentSheetSync({
        getCustomerDocForGroup: async () => mockDoc,
        getGroupRole: async () => 'report',
        moment: () => {}
    });

    await sync.writeAppointmentRow('-1001', 'NV A', {
        'Ngày': '18/09/2026',
        'Nhân Viên': 'NV A',
        'Khách Hàng': 'Khách A',
        'SĐT': '0901',
        'Thời Gian': '10:00 18/09/2026'
    });

    assert.equal(savedMasterData['Loại khách'], 'Khách cũ');
    assert.deepEqual(setHeaders, [
        'Ngày', 'Nhân Viên', 'Mã NV', 'Khách Hàng', 'Loại khách', 'SĐT', 'Dịch Vụ', 'Buổi Làm',
        'Thời Gian', 'Trạng Thái', 'Lý Do Hủy', 'Thu Tiền', 'Ảnh Chứng Thực'
    ]);
});

