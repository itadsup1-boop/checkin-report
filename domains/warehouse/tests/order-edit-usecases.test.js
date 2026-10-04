import test from 'node:test';
import assert from 'node:assert/strict';
import { createGetOrderEditDetailUseCase } from '../application/get-order-edit-detail.js';
import { createEditCustomerOrderUseCase } from '../application/edit-customer-order.js';
import { createEditWarehouseImportUseCase } from '../application/edit-warehouse-import.js';

test('createGetOrderEditDetailUseCase - returns edit detail and window/auth check', async () => {
    const mockOrder = {
        id: 'ord-1',
        branch: 'US',
        status: 'APPROVED',
        created_at: new Date().toISOString(),
        created_by: 'emp-1'
    };
    const mockRepo = {
        findExportOrderForEdit: async () => ({
            order: mockOrder,
            items: [{ id: 'item-1', product_id: 'p-1', actual_quantity: 2 }],
            stockMap: { 'p-1': 10 }
        })
    };
    const mockService = {
        authorizeActor: async () => ({
            employee: { id: 'emp-1', role: 'Staff' },
            group: { id: 'grp-1' }
        })
    };

    const getDetail = createGetOrderEditDetailUseCase({
        orderEditRepo: mockRepo,
        warehouseOrderService: mockService
    });

    const res = await getDetail({
        targetType: 'EXPORT',
        id: 'ord-1',
        telegramId: '123',
        chatId: '-100'
    });

    assert.equal(res.canEdit, true);
    assert.equal(res.order.id, 'ord-1');
    assert.equal(res.items.length, 1);
});

test('createEditCustomerOrderUseCase - successfully applies delta when stock is available', async () => {
    const mockOrder = {
        id: 'ord-1',
        branch: 'US',
        status: 'APPROVED',
        created_at: new Date().toISOString(),
        created_by: 'emp-1'
    };
    let appliedData = null;
    const mockRepo = {
        findExportOrderForEdit: async () => ({
            order: mockOrder,
            items: [{ id: 'item-1', product_id: 'p-1', product_name_snapshot: 'Filler', actual_quantity: 2 }],
            stockMap: { 'p-1': 10 }
        }),
        applyExportOrderEdit: async (client, data) => {
            appliedData = data;
        }
    };
    const mockService = {
        authorizeActor: async () => ({
            employee: { id: 'emp-1', role: 'Staff' },
            group: { id: 'grp-1' }
        })
    };
    const fakeWithTransaction = async (cb) => cb({});

    const editOrder = createEditCustomerOrderUseCase({
        orderEditRepo: mockRepo,
        warehouseOrderService: mockService,
        withTransaction: fakeWithTransaction
    });

    const result = await editOrder({
        orderId: 'ord-1',
        telegramId: '123',
        chatId: '-100',
        editReason: 'Khách đổi ý tăng thêm 1 lọ',
        updatedItems: [
            { id: 'item-1', product_id: 'p-1', product_name: 'Filler', actual_quantity: 3 }
        ]
    });

    assert.equal(result.success, true);
    assert.equal(result.modified, true);
    assert.equal(result.deltas[0].delta, 1);
    assert.equal(appliedData.editReason, 'Khách đổi ý tăng thêm 1 lọ');
    assert.equal(appliedData.deltas[0].delta, 1);
});

test('createEditCustomerOrderUseCase - blocks edit if expired > 24h', async () => {
    const pastDate = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    const mockOrder = {
        id: 'ord-1',
        branch: 'US',
        status: 'APPROVED',
        created_at: pastDate,
        created_by: 'emp-1'
    };
    const mockRepo = {
        findExportOrderForEdit: async () => ({
            order: mockOrder,
            items: [],
            stockMap: {}
        })
    };
    const mockService = {
        authorizeActor: async () => ({
            employee: { id: 'emp-1' },
            group: { id: 'grp-1' }
        })
    };
    const fakeWithTransaction = async (cb) => cb({});

    const editOrder = createEditCustomerOrderUseCase({
        orderEditRepo: mockRepo,
        warehouseOrderService: mockService,
        withTransaction: fakeWithTransaction
    });

    await assert.rejects(
        () => editOrder({
            orderId: 'ord-1',
            telegramId: '123',
            chatId: '-100',
            editReason: 'Sửa trễ',
            updatedItems: []
        }),
        /quá 24 giờ/
    );
});

test('createEditWarehouseImportUseCase - successfully updates quantity and checks stock reduction', async () => {
    const mockTransaction = {
        id: 'tx-1',
        product_id: 'p-1',
        branch: 'US',
        quantity: 5,
        status: 'APPROVED',
        created_at: new Date().toISOString(),
        user_id: 'emp-1'
    };
    let appliedData = null;
    const mockRepo = {
        findImportTransactionForEdit: async () => ({
            transaction: mockTransaction,
            currentStock: 4 // current stock is 4
        }),
        applyImportTransactionEdit: async (client, data) => {
            appliedData = data;
        }
    };
    const mockService = {
        authorizeActor: async () => ({
            employee: { id: 'emp-1' },
            group: { id: 'grp-1' }
        })
    };
    const fakeWithTransaction = async (cb) => cb({});

    const editImport = createEditWarehouseImportUseCase({
        orderEditRepo: mockRepo,
        warehouseOrderService: mockService,
        withTransaction: fakeWithTransaction
    });

    // 1. Giảm từ 5 xuống 3 (delta = -2), stock = 4 >= 2 -> Hợp lệ
    const result = await editImport({
        transactionId: 'tx-1',
        telegramId: '123',
        chatId: '-100',
        editReason: 'Nhập nhầm thừa 2 hộp',
        newQuantity: 3
    });

    assert.equal(result.success, true);
    assert.equal(result.delta, -2);
    assert.equal(appliedData.newQuantity, 3);

    // 2. Giảm từ 5 xuống 0.5 (delta = -4.5), stock = 4 < 4.5 -> Báo lỗi không cho giảm âm kho
    await assert.rejects(
        () => editImport({
            transactionId: 'tx-1',
            telegramId: '123',
            chatId: '-100',
            editReason: 'Giảm quá mức',
            newQuantity: 0.5
        }),
        /không đủ để giảm/
    );
});
