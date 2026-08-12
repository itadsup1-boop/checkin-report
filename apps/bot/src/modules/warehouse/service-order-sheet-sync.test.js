import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { createServiceOrderSheetSync } from './integrations/service-order-sheet-sync.js';

class FakeRow {
    constructor(data) {
        this.data = { ...data };
        this.saveCount = 0;
    }

    get(key) {
        return this.data[key];
    }

    set(key, value) {
        this.data[key] = value;
    }

    async save() {
        this.saveCount += 1;
    }
}

class FakeSheet {
    constructor(title, headers = []) {
        this.title = title;
        this.headers = headers;
        this.rows = [];
    }

    async setHeaderRow(headers) {
        this.headers = [...headers];
    }

    async getRows() {
        return this.rows;
    }

    async addRow(data) {
        const row = new FakeRow(data);
        this.rows.push(row);
        return row;
    }
}

test('đồng bộ Sheet giữ 6 tab, chống ghi trùng và phản ánh hoàn tác', async () => {
    const doc = {
        sheetsByTitle: {
            '2. Nhập kho': new FakeSheet('2. Nhập kho')
        },
        async loadInfo() {},
        async addSheet({ title, headerValues }) {
            const sheet = new FakeSheet(title, headerValues);
            this.sheetsByTitle[title] = sheet;
            return sheet;
        }
    };
    let status = 'APPROVED';
    let syncUpdates = 0;
    const pool = {
        async query(sql) {
            if (sql.includes('SELECT o.*')) {
                return { rows: [{
                    id: 'order-1',
                    order_code: 'ORD-001',
                    status,
                    branch: 'UK',
                    customer_name: 'Khách test',
                    customer_phone: '0900000000',
                    creator_name: 'Nhân viên A',
                    approver_name: 'Quản lý B',
                    approved_at: new Date('2026-08-12T01:00:00Z'),
                    created_at: new Date('2026-08-12T00:00:00Z'),
                    reversed_by_admin_id: status === 'REVERSED' ? 'admin-1' : null,
                    reversed_at: status === 'REVERSED' ? new Date('2026-08-12T02:00:00Z') : null
                }] };
            }
            if (sql.includes('SELECT oi.id')) {
                return { rows: [{
                    id: 'item-1',
                    product_id: 'product-1',
                    product_name_snapshot: 'Kim test',
                    barcode_snapshot: 'BC-001',
                    actual_quantity: 3,
                    local_allocated_quantity: 1,
                    transfer_allocated_quantity: 2,
                    transfer_from_branch: 'US',
                    service_name_snapshot: 'Căng da'
                }] };
            }
            if (sql.includes('SELECT t.transfer_code')) {
                return { rows: [{
                    transfer_code: 'TRF-001',
                    from_branch: 'US',
                    to_branch: 'UK',
                    status: status === 'REVERSED' ? 'REVERSED' : 'NOTIFIED',
                    confirmed_at: new Date('2026-08-12T01:00:00Z'),
                    transfer_item_id: 'transfer-item-1',
                    quantity: 2,
                    product_name: 'Kim test',
                    barcode: 'BC-001'
                }] };
            }
            if (sql.includes('SELECT p.id')) {
                return { rows: [{
                    id: 'product-1',
                    barcode: 'BC-001',
                    product_name: 'Kim test',
                    stock_us: status === 'REVERSED' ? 10 : 8,
                    stock_uk: status === 'REVERSED' ? 5 : 4
                }] };
            }
            if (sql.includes('UPDATE tk_warehouse_orders')) {
                syncUpdates += 1;
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Query không được mô phỏng: ${sql}`);
        }
    };
    const sync = createServiceOrderSheetSync({
        pool,
        moment,
        getDocById: async () => doc
    });

    await sync.syncWarehouseOrder('order-1');
    await sync.syncWarehouseOrder('order-1');
    assert.deepEqual(Object.keys(doc.sheetsByTitle).sort(), [
        '1. Xuất kho',
        '2. Nhập kho',
        '3. Tồn kho US',
        '4. Tồn kho UK',
        '5. Tổng kho',
        '6. Điều chuyển nội bộ'
    ]);
    assert.equal(doc.sheetsByTitle['1. Xuất kho'].rows.length, 1);
    assert.equal(doc.sheetsByTitle['6. Điều chuyển nội bộ'].rows.length, 1);
    assert.equal(doc.sheetsByTitle['3. Tồn kho US'].rows.length, 1);
    assert.equal(doc.sheetsByTitle['4. Tồn kho UK'].rows.length, 1);
    assert.equal(doc.sheetsByTitle['5. Tổng kho'].rows.length, 1);

    status = 'REVERSED';
    await sync.syncWarehouseOrder('order-1');
    const exportRow = doc.sheetsByTitle['1. Xuất kho'].rows[0];
    const transferRow = doc.sheetsByTitle['6. Điều chuyển nội bộ'].rows[0];
    assert.equal(exportRow.get('Trạng thái đơn'), 'Đã hoàn tác');
    assert.equal(exportRow.get('Người hoàn tác'), 'admin-1');
    assert.equal(transferRow.get('Trạng thái'), 'Đã hoàn tác');
    assert.equal(doc.sheetsByTitle['3. Tồn kho US'].rows[0].get('Số lượng tồn kho'), 10);
    assert.equal(doc.sheetsByTitle['4. Tồn kho UK'].rows[0].get('Số lượng tồn kho'), 5);
    assert.equal(syncUpdates, 3);
});
