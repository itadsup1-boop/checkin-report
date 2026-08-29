import { randomUUID } from 'node:crypto';
import { WarehouseError } from '../domain/constants.js';
import { QUANTITY_MODES, parseQuantity, quantityModeLabel, roundQuantity } from '../domain/quantity-rules.js';
import { calculateBaseQuantity } from '../domain/unit-conversion.js';
import { validateStockReceiptInput } from '../domain/stock-receipt-rules.js';

export function createStockReceiptUseCase({
    catalogRepo, inventoryRepo, ledgerRepo, receiptRepo, outboxRepo, withTransaction
}) {
    async function importProductsAsAdmin({ adminId, adminName, group, input }) {
        const normalized = validateStockReceiptInput(input);
        const receiptId = randomUUID();

        return withTransaction(async client => {
            const productIds = normalized.items.map(item => item.product_id);
            const products = await catalogRepo.listActiveProducts(client, productIds);
            const productById = new Map(products.map(product => [String(product.id), product]));

            for (const productId of productIds) {
                if (!productById.has(productId)) {
                    throw new WarehouseError('Có sản phẩm không tồn tại hoặc đã bị ẩn.', {
                        status: 409,
                        code: 'PRODUCT_NOT_FOUND'
                    });
                }
                await inventoryRepo.ensureBranchRows(client, productId);
            }

            const stocks = await inventoryRepo.listStocks(client, productIds, { lock: true });
            const stockByProduct = new Map(
                stocks
                    .filter(row => row.branch === normalized.branch)
                    .map(row => [String(row.product_id), Number(row.quantity)])
            );
            const resultItems = [];
            const transactionItems = [];

            for (const item of normalized.items) {
                const product = productById.get(item.product_id);
                const hasImportConversion = Boolean(product.import_unit)
                    && Number(product.conversion_rate) > 1;
                const inputMode = hasImportConversion ? QUANTITY_MODES.INTEGER : product.quantity_mode;
                const enteredQuantity = parseQuantity(item.quantity, inputMode);
                if (enteredQuantity === null) {
                    throw new WarehouseError(
                        `Số lượng nhập của “${product.product_name}” phải là ${quantityModeLabel(inputMode)}.`,
                        { code: 'WAREHOUSE_RECEIPT_QUANTITY_INVALID' }
                    );
                }

                const baseQuantity = hasImportConversion
                    ? calculateBaseQuantity(enteredQuantity, product.conversion_rate)
                    : enteredQuantity;
                const balanceBefore = stockByProduct.get(item.product_id) || 0;
                const balanceAfter = roundQuantity(balanceBefore + baseQuantity);

                await inventoryRepo.increase(
                    client,
                    item.product_id,
                    normalized.branch,
                    baseQuantity
                );
                const transaction = await receiptRepo.createImportTransaction(client, {
                    groupId: group.id,
                    productId: item.product_id,
                    quantity: baseQuantity,
                    branch: normalized.branch,
                    adminId
                });
                await ledgerRepo.recordAdminImport(client, {
                    receiptId,
                    transactionId: transaction.id,
                    groupId: group.id,
                    productId: item.product_id,
                    branch: normalized.branch,
                    quantity: baseQuantity,
                    balanceBefore,
                    balanceAfter,
                    adminId,
                    metadata: {
                        source: 'WEB_ADMIN',
                        actor_name: adminName,
                        note: normalized.note || null,
                        entered_quantity: enteredQuantity,
                        entered_unit: hasImportConversion ? product.import_unit : product.base_unit,
                        base_unit: product.base_unit,
                        conversion_rate: hasImportConversion ? Number(product.conversion_rate) : 1
                    }
                });

                stockByProduct.set(item.product_id, balanceAfter);
                resultItems.push({
                    product_id: product.id,
                    product_name: product.product_name,
                    barcode: product.barcode,
                    entered_quantity: enteredQuantity,
                    entered_unit: hasImportConversion ? product.import_unit : product.base_unit,
                    quantity: baseQuantity,
                    base_unit: product.base_unit,
                    new_stock: balanceAfter
                });
                transactionItems.push({ productId: product.id, transactionId: transaction.id });
            }

            await outboxRepo.enqueueAdminImport(client, receiptId, {
                receipt_id: receiptId,
                telegram_group_id: group.telegram_group_id,
                group_name: group.group_name,
                branch: normalized.branch,
                actor_name: adminName,
                items: resultItems,
                transactionItems
            });

            return {
                receipt_id: receiptId,
                branch: normalized.branch,
                group_id: group.telegram_group_id,
                items: resultItems
            };
        });
    }

    return { importProductsAsAdmin };
}

