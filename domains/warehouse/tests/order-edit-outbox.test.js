import test from 'node:test';
import assert from 'node:assert/strict';
import { startWarehouseOutboxWorker } from '../infrastructure/outbox/outbox-worker.js';

test('outbox worker - processes ORDER_EDITED and triggers sync and notifications', async () => {
    let syncedOrderId = null;
    let editedMessageText = null;
    let sentRoleMessage = null;
    let claimed = false;

    const mockOrder = {
        id: 'ord-123',
        order_code: 'ORD-TEST-001',
        branch: 'US',
        customer_name: 'Nguyen Van A',
        telegram_group_id: '-100123456789',
        telegram_message_id: 9999,
        services: [
            {
                service_name_snapshot: 'Dịch vụ Tiêm',
                items: [
                    { product_name: 'Botox', actual_quantity: 2, is_removed: false }
                ]
            }
        ]
    };

    const mockPool = {
        connect: async () => ({
            query: async (sql) => {
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
                if (sql.includes('FROM tk_warehouse_outbox') && sql.includes('SELECT id')) {
                    if (!claimed) {
                        claimed = true;
                        return { rows: [{ id: 'evt-1' }] };
                    }
                    return { rows: [] };
                }
                if (sql.includes('UPDATE tk_warehouse_outbox') && sql.includes('PROCESSING')) {
                    return {
                        rows: [{
                            id: 'evt-1',
                            aggregate_id: 'ord-123',
                            event_type: 'ORDER_EDITED',
                            attempts: 0,
                            payload: {
                                orderId: 'ord-123',
                                editReason: 'Khách tăng 1 lọ',
                                editorTelegramId: '456',
                                deltas: [{ productName: 'Botox', oldQuantity: 1, newQuantity: 2, delta: 1 }]
                            }
                        }]
                    };
                }
                return { rows: [] };
            },
            release: () => {}
        }),
        query: async (sql) => {
            if (sql.includes('SELECT full_name FROM employees')) {
                return { rows: [{ full_name: 'Trần Văn Sửa' }] };
            }
            return { rows: [] };
        }
    };

    const mockBot = {
        telegram: {
            editMessageText: async (groupId, messageId, inlineId, text) => {
                editedMessageText = text;
            }
        }
    };

    const worker = startWarehouseOutboxWorker({
        pool: mockPool,
        bot: mockBot,
        sendMessageToRoleGroup: async (bot, chatId, role, text) => {
            sentRoleMessage = { chatId, role, text };
            return { message_id: 10001 };
        },
        sendMediaGroupToRoleGroup: async () => true,
        warehouseOrderService: {
            repository: {
                getOrderDetail: async () => mockOrder
            }
        },
        syncWarehouseOrder: async (id) => {
            syncedOrderId = id;
        },
        syncWarehouseSheets: async () => {},
        moment: () => ({ utcOffset: () => ({ format: () => '14:30 04/10/2026' }) }),
        escapeHtml: (s) => String(s ?? ''),
        autoStart: false
    });

    await worker.runOnce();

    assert.equal(syncedOrderId, 'ord-123');
    assert.match(editedMessageText, /Đơn đã được sửa bởi Trần Văn Sửa/);
    assert.match(editedMessageText, /Khách tăng 1 lọ/);
    assert.ok(sentRoleMessage);
    assert.equal(sentRoleMessage.role, 'warehouse');
    assert.match(sentRoleMessage.text, /ĐƠN XUẤT KHO ĐÃ ĐƯỢC CHỈNH SỬA/);
    assert.match(sentRoleMessage.text, /Botox: 1 ➔ <b>2<\/b> \(\+1\)/);
});

test('outbox worker - processes IMPORT_EDITED and triggers sync and notifications', async () => {
    let syncedProductTx = null;
    let sentRoleMessage = null;
    let claimed = false;

    const mockPool = {
        connect: async () => ({
            query: async (sql) => {
                if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
                if (sql.includes('FROM tk_warehouse_outbox') && sql.includes('SELECT id')) {
                    if (!claimed) {
                        claimed = true;
                        return { rows: [{ id: 'evt-2' }] };
                    }
                    return { rows: [] };
                }
                if (sql.includes('UPDATE tk_warehouse_outbox') && sql.includes('PROCESSING')) {
                    return {
                        rows: [{
                            id: 'evt-2',
                            aggregate_id: 'tx-456',
                            event_type: 'IMPORT_EDITED',
                            attempts: 0,
                            payload: {
                                transactionId: 'tx-456',
                                editReason: 'Nhập thừa 2 hộp',
                                editorTelegramId: '789',
                                oldQuantity: 10,
                                newQuantity: 8,
                                delta: -2,
                                productName: 'Filler Juvederm',
                                branch: 'US'
                            }
                        }]
                    };
                }
                return { rows: [] };
            },
            release: () => {}
        }),
        query: async (sql) => {
            if (sql.includes('FROM tk_warehouse_transactions t')) {
                return {
                    rows: [{
                        id: 'tx-456',
                        product_id: 'prod-1',
                        product_name: 'Filler Juvederm',
                        branch: 'US',
                        telegram_group_id: '-100987654321',
                        editor_name: 'Lê Quản Lý'
                    }]
                };
            }
            return { rows: [] };
        }
    };

    const worker = startWarehouseOutboxWorker({
        pool: mockPool,
        bot: {},
        sendMessageToRoleGroup: async (bot, chatId, role, text) => {
            sentRoleMessage = { chatId, role, text };
            return { message_id: 10002 };
        },
        sendMediaGroupToRoleGroup: async () => true,
        warehouseOrderService: { repository: {} },
        syncWarehouseOrder: async () => {},
        syncWarehouseSheets: async (prodId, txId) => {
            syncedProductTx = { prodId, txId };
        },
        moment: () => ({ utcOffset: () => ({ format: () => '14:30 04/10/2026' }) }),
        escapeHtml: (s) => String(s ?? ''),
        autoStart: false
    });

    await worker.runOnce();

    assert.deepEqual(syncedProductTx, { prodId: 'prod-1', txId: 'tx-456' });
    assert.ok(sentRoleMessage);
    assert.equal(sentRoleMessage.role, 'warehouse');
    assert.match(sentRoleMessage.text, /PHIẾU NHẬP KHO ĐÃ ĐƯỢC CHỈNH SỬA/);
    assert.match(sentRoleMessage.text, /10 ➔ <b>8<\/b> \(-2\)/);
    assert.match(sentRoleMessage.text, /Nhập thừa 2 hộp/);
});
