/**
 * Tạo đơn xuất kho theo khách hàng (một khách, nhiều dịch vụ).
 *
 * Hai đường đi sau khi tạo:
 *   - Người tạo có quyền tự duyệt  -> duyệt luôn, trừ tồn ngay
 *   - Không có quyền               -> để chờ, kèm gợi ý cần lấy bù bao nhiêu
 *
 * Chống gửi trùng bằng idempotency_key: Mini App gửi lại (bấm hai lần, mạng lag)
 * sẽ trả về đúng đơn cũ thay vì tạo đơn thứ hai.
 */

import { WAREHOUSE_ORDER_STATUSES, WarehouseError } from '../domain/constants.js';
import { validateOrderInput } from '../domain/order-validation.js';
import { makeCode } from './_shared/codes.js';

export function createCreateCustomerOrderUseCase({
    repository, orderRepo, outboxRepo,
    availability: availabilityService, actorContext: actorContextResolver,
    orderGraph, approveLockedOrder, withTransaction
}) {
    const { getAvailability } = availabilityService;
    const { getActorContext } = actorContextResolver;
    const { validateAndSnapshotGraph } = orderGraph;

    async function createOrder({ telegramId, chatId, input, submit = true }) {
        const normalized = validateOrderInput(input, { allowDraft: !submit });

        const orderId = await withTransaction(async client => {
            const actorContext = await getActorContext(client, telegramId, chatId, {
                requireEmployee: false
            });
            if (!actorContext.group.warehouse_service_order_enabled) {
                throw new WarehouseError('Nhóm này chưa bật phiên bản đơn dịch vụ mới.', {
                    status: 409,
                    code: 'WAREHOUSE_FEATURE_DISABLED'
                });
            }

            const duplicate = await orderRepo.findByIdempotencyKey(
                client, actorContext.group.id, normalized.idempotency_key
            );
            if (duplicate) return duplicate.id;

            const graph = await validateAndSnapshotGraph(client, normalized);
            const status = submit
                ? WAREHOUSE_ORDER_STATUSES.PENDING
                : WAREHOUSE_ORDER_STATUSES.DRAFT;

            const order = await orderRepo.create(client, {
                orderCode: makeCode('ORD'),
                groupId: actorContext.group.id,
                createdBy: actorContext.employee?.id || null,
                createdByTelegramId: actorContext.telegramId,
                customerName: normalized.customer_name,
                customerPhone: normalized.customer_phone,
                branch: normalized.branch,
                status,
                idempotencyKey: normalized.idempotency_key,
                telegramChatId: String(chatId)
            });

            const insertedItems = [];
            for (const service of graph) {
                const orderService = await orderRepo.addService(client, {
                    orderId: order.id,
                    serviceId: service.service_id,
                    serviceCode: service.snapshot.service_code,
                    serviceName: service.snapshot.service_name,
                    displayOrder: service.display_order
                });
                for (const item of service.items) {
                    const inserted = await orderRepo.addItem(client, {
                        orderServiceId: orderService.id,
                        productId: item.product_id,
                        productName: item.product.product_name,
                        barcode: item.product.barcode,
                        templateQuantity: item.template_quantity,
                        actualQuantity: item.actual_quantity,
                        itemSource: item.item_source,
                        isRemoved: item.is_removed,
                        displayOrder: item.display_order
                    });
                    insertedItems.push(inserted);
                }
            }

            if (submit) {
                const availability = await getAvailability(client, insertedItems);
                if (availability.shortages.length) {
                    throw new WarehouseError('Tổng tồn hai cơ sở không đủ để gửi đơn.', {
                        status: 409,
                        code: 'INSUFFICIENT_STOCK',
                        details: availability.shortages
                    });
                }

                const canAutoApprove = actorContext.isAdmin
                    || actorContext.permissions.has('AUTO_APPROVE_OWN_ORDER')
                    || actorContext.permissions.has('APPROVE_EXPORT');

                if (canAutoApprove) {
                    await approveLockedOrder(client, order, actorContext);
                } else {
                    // Chưa đủ quyền: báo nhóm để người có quyền vào duyệt, kèm
                    // gợi ý mặt hàng nào cần lấy bù từ cơ sở kia.
                    const otherBranch = normalized.branch === 'US' ? 'UK' : 'US';
                    const transferSuggestions = availability.allocations
                        .filter(allocation => allocation.required > allocation[normalized.branch])
                        .map(allocation => ({
                            product_id: allocation.product_id,
                            product_name: allocation.product_name,
                            barcode: allocation.barcode,
                            from_branch: otherBranch,
                            to_branch: normalized.branch,
                            quantity: allocation.required - allocation[normalized.branch]
                        }));
                    await outboxRepo.enqueue(client, order.id, 'ORDER_PENDING_APPROVAL', {
                        transfer_suggestions: transferSuggestions
                    });
                }
            }

            return order.id;
        });

        // Đọc lại SAU khi commit: repository dùng pool riêng.
        return repository.getOrderDetail(orderId);
    }

    return { createOrder };
}
