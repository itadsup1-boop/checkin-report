/**
 * Chuyển kho: chuyển hàng THẬT từ cơ sở này sang cơ sở kia, không gắn đơn xuất
 * nào. Khác điều chuyển "dùng ngay" ở approve-order.js — hàng ở đây thực sự
 * nằm lại tồn kho cơ sở đích.
 *
 * Chặn cứng nếu cơ sở nguồn không đủ hàng cho bất kỳ sản phẩm nào trong phiếu
 * (không cho chuyển một phần) — tránh phiếu chuyển kho dở dang khó đối chiếu.
 *
 * Ai được làm: quyền APPROVE_TRANSFER (đã cấp sẵn cho nhân viên kho) hoặc Admin.
 */

import { WarehouseError } from '../domain/constants.js';
import { validateStockTransferInput, findInsufficientStock } from '../domain/stock-transfer-rules.js';
import { makeCode } from './_shared/codes.js';

export function createCreateStockTransferUseCase({
    repository, inventoryRepo, ledgerRepo, transferRepo, outboxRepo, catalogRepo,
    actorContext: actorContextResolver, withTransaction
}) {
    const { getActorContext } = actorContextResolver;

    async function createStockTransfer({ telegramId, chatId, input }) {
        const normalized = validateStockTransferInput(input);

        const transferId = await withTransaction(async client => {
            const actorContext = await getActorContext(client, telegramId, chatId, {
                requireEmployee: false
            });

            const canTransfer = actorContext.isAdmin
                || actorContext.permissions.has('APPROVE_TRANSFER');
            if (!canTransfer) {
                throw new WarehouseError('Bạn không có quyền chuyển kho.', {
                    status: 403,
                    code: 'WAREHOUSE_PERMISSION_DENIED'
                });
            }

            const productIds = normalized.items.map(item => item.product_id);
            const products = await catalogRepo.listActiveProducts(client, productIds);
            const productById = new Map(products.map(product => [product.id, product]));
            for (const item of normalized.items) {
                if (!productById.has(item.product_id)) {
                    throw new WarehouseError('Có sản phẩm không tồn tại hoặc đã ẩn.', {
                        status: 409,
                        code: 'PRODUCT_NOT_FOUND'
                    });
                }
            }

            const stocks = await inventoryRepo.listStocks(client, productIds, { lock: true });
            const fromStockByProduct = new Map(
                stocks.filter(row => row.branch === normalized.from_branch)
                    .map(row => [row.product_id, Number(row.quantity)])
            );
            const toStockByProduct = new Map(
                stocks.filter(row => row.branch === normalized.to_branch)
                    .map(row => [row.product_id, Number(row.quantity)])
            );

            const shortages = findInsufficientStock(normalized.items, fromStockByProduct);
            if (shortages.length) {
                throw new WarehouseError('Cơ sở nguồn không đủ hàng để chuyển.', {
                    status: 409,
                    code: 'INSUFFICIENT_STOCK',
                    details: shortages.map(shortage => ({
                        ...shortage,
                        product_name: productById.get(shortage.product_id)?.product_name || null
                    }))
                });
            }

            const transfer = await transferRepo.createStockTransfer(client, {
                transferCode: makeCode('TRF'),
                telegramGroupId: actorContext.group.telegram_group_id,
                fromBranch: normalized.from_branch,
                toBranch: normalized.to_branch,
                actor: { employeeId: actorContext.employee?.id || null, telegramId: actorContext.telegramId }
            });

            const movedItems = [];
            for (const item of normalized.items) {
                const product = productById.get(item.product_id);
                const fromBalanceBefore = fromStockByProduct.get(item.product_id) || 0;
                const toBalanceBefore = toStockByProduct.get(item.product_id) || 0;

                const deducted = await inventoryRepo.deduct(client, item.product_id, normalized.from_branch, item.quantity);
                if (!deducted) {
                    throw new WarehouseError('Tồn kho vừa bị thay đổi, vui lòng thử lại.', {
                        status: 409,
                        code: 'INSUFFICIENT_STOCK'
                    });
                }
                await inventoryRepo.increase(client, item.product_id, normalized.to_branch, item.quantity);
                await transferRepo.addItem(client, transfer.id, item.product_id, item.quantity);

                const fromBalanceAfter = fromBalanceBefore - item.quantity;
                const toBalanceAfter = toBalanceBefore + item.quantity;
                await ledgerRepo.recordStockTransfer(client, {
                    transferId: transfer.id,
                    groupId: actorContext.group.id,
                    productId: item.product_id,
                    fromBranch: normalized.from_branch,
                    toBranch: normalized.to_branch,
                    quantity: item.quantity,
                    fromBalanceBefore,
                    fromBalanceAfter,
                    toBalanceBefore,
                    toBalanceAfter,
                    actor: { employeeId: actorContext.employee?.id || null, telegramId: actorContext.telegramId }
                });

                movedItems.push({
                    product_id: item.product_id,
                    product_name: product.product_name,
                    barcode: product.barcode,
                    quantity: item.quantity
                });
            }

            await outboxRepo.enqueueStockTransfer(client, transfer.id, 'STOCK_TRANSFER_COMPLETED', {
                transfer_code: transfer.transfer_code,
                telegram_group_id: actorContext.group.telegram_group_id,
                from_branch: normalized.from_branch,
                to_branch: normalized.to_branch,
                actor_telegram_id: actorContext.telegramId,
                items: movedItems
            });

            return transfer.id;
        });

        return repository.getStockTransferDetail(transferId);
    }

    return { createStockTransfer };
}
