import test from 'node:test';
import assert from 'node:assert/strict';
import { createStockReceiptUseCase } from '../application/create-stock-receipt.js';

function createHarness(productOverrides = {}) {
    const calls = { increases: [], ledger: [], outbox: [] };
    const product = {
        id: '00000000-0000-0000-0000-000000000001',
        barcode: 'SP-01',
        product_name: 'Sản phẩm 1',
        quantity_mode: 'DECIMAL',
        base_unit: 'ml',
        import_unit: 'Lọ',
        conversion_rate: 2.5,
        ...productOverrides
    };
    const useCase = createStockReceiptUseCase({
        catalogRepo: {
            listActiveProducts: async () => [product]
        },
        inventoryRepo: {
            ensureBranchRows: async () => undefined,
            listStocks: async () => [
                { product_id: product.id, branch: 'US', quantity: 5 },
                { product_id: product.id, branch: 'UK', quantity: 1 }
            ],
            increase: async (...args) => calls.increases.push(args.slice(1))
        },
        receiptRepo: {
            createImportTransaction: async () => ({
                id: '00000000-0000-0000-0000-000000000099'
            })
        },
        ledgerRepo: {
            recordAdminImport: async (_db, input) => calls.ledger.push(input)
        },
        outboxRepo: {
            enqueueAdminImport: async (_db, id, payload) => calls.outbox.push({ id, payload })
        },
        withTransaction: async work => work({ query: async () => ({ rows: [] }) })
    });
    return { useCase, calls, product };
}

test('phiếu nhập Web quy đổi đơn vị, cộng tồn và ghi ledger trong cùng use case', async () => {
    const { useCase, calls, product } = createHarness();
    const result = await useCase.importProductsAsAdmin({
        adminId: 'admin-id',
        adminName: 'Super Admin',
        group: {
            id: '00000000-0000-0000-0000-000000000010',
            telegram_group_id: '-10001',
            group_name: 'Kho chính'
        },
        input: {
            branch: 'US',
            note: 'Nhập từ Web',
            items: [{ product_id: product.id, quantity: 2 }]
        }
    });

    assert.equal(result.items[0].entered_quantity, 2);
    assert.equal(result.items[0].quantity, 5);
    assert.equal(result.items[0].new_stock, 10);
    assert.deepEqual(calls.increases[0], [product.id, 'US', 5]);
    assert.equal(calls.ledger[0].balanceBefore, 5);
    assert.equal(calls.ledger[0].balanceAfter, 10);
    assert.equal(calls.ledger[0].metadata.source, 'WEB_ADMIN');
    assert.equal(calls.outbox.length, 1);
});

test('sản phẩm nhập theo đơn vị đóng gói không nhận số lượng lẻ', async () => {
    const { useCase, product } = createHarness();
    await assert.rejects(
        useCase.importProductsAsAdmin({
            adminId: 'admin-id',
            adminName: 'Admin',
            group: { id: 'group-id', telegram_group_id: '-10001' },
            input: {
                branch: 'UK',
                items: [{ product_id: product.id, quantity: 1.2 }]
            }
        }),
        error => error.code === 'WAREHOUSE_RECEIPT_QUANTITY_INVALID'
    );
});
