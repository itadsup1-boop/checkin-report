import { randomUUID } from 'node:crypto';
import {
    WAREHOUSE_ORDER_STATUSES,
    WarehouseError
} from '../domain/constants.js';
import {
    aggregateOrderItems,
    validateOrderInput
} from '../domain/order-validation.js';
import { createWarehouseQueryRepository } from '../infrastructure/postgres/warehouse-query-repository.js';
import { createInventoryRepository } from '../infrastructure/postgres/inventory-repository.js';
import { createLedgerRepository } from '../infrastructure/postgres/ledger-repository.js';
import { createTransferRepository } from '../infrastructure/postgres/transfer-repository.js';
import { createOutboxRepository } from '../infrastructure/postgres/outbox-repository.js';
import { createOrderRepository } from '../infrastructure/postgres/order-repository.js';
import { createCatalogRepository } from '../infrastructure/postgres/catalog-repository.js';

function makeCode(prefix) {
    const date = new Date();
    const ymd = date.toISOString().slice(0, 10).replaceAll('-', '');
    return `${prefix}-${ymd}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function parseAdminIds(adminIds) {
    if (adminIds instanceof Set) return adminIds;
    if (Array.isArray(adminIds)) return new Set(adminIds.map(String));
    return new Set(String(adminIds || '').split(',').map(value => value.trim()).filter(Boolean));
}

export function createWarehouseOrderService({ pool, adminIds = [] }) {
    const repository = createWarehouseQueryRepository(pool);
    const adminTelegramIds = parseAdminIds(adminIds);

    // Mọi câu SQL nằm ở tầng infrastructure. Tầng này chỉ điều phối nghiệp vụ.
    const inventoryRepo = createInventoryRepository(pool);
    const ledgerRepo = createLedgerRepository(pool);
    const transferRepo = createTransferRepository(pool);
    const outboxRepo = createOutboxRepository(pool);
    const orderRepo = createOrderRepository(pool);
    const catalogRepo = createCatalogRepository(pool);

    async function getActorContext(client, telegramId, chatId, { requireEmployee = false } = {}) {
        const group = await repository.getActiveGroup(chatId, client);
        const isAdmin = adminTelegramIds.has(String(telegramId));
        let employee = null;
        try {
            employee = await repository.getActiveEmployee(telegramId, chatId, client);
        } catch (error) {
            if (!isAdmin || requireEmployee) throw error;
        }
        const permissions = employee
            ? await repository.getPermissionSet(employee.id, chatId, client)
            : new Set();
        if (employee && !isAdmin) {
            const isGroupMember = await repository.hasActiveGroupMembership(employee.id, chatId, client);
            if (!isGroupMember && permissions.size === 0) {
                throw new WarehouseError('Bạn không phải thành viên của nhóm kho này.', {
                    status: 403,
                    code: 'WAREHOUSE_GROUP_MEMBERSHIP_REQUIRED'
                });
            }
        }
        return {
            group,
            employee,
            permissions,
            isAdmin,
            telegramId: String(telegramId)
        };
    }

    async function validateAndSnapshotGraph(client, normalized) {
        const serviceIds = normalized.services.map(service => service.service_id);
        const activeServices = await catalogRepo.listActiveServices(client, serviceIds);
        const serviceMap = new Map(activeServices.map(row => [row.id, row]));
        if (serviceMap.size !== new Set(serviceIds).size) {
            throw new WarehouseError('Có dịch vụ không tồn tại hoặc đã tạm ẩn.', {
                code: 'INACTIVE_SERVICE'
            });
        }

        const productIds = [...new Set(normalized.services.flatMap(service =>
            service.items.map(item => item.product_id)
        ))];
        const activeProducts = await catalogRepo.listActiveProducts(client, productIds);
        const productMap = new Map(activeProducts.map(row => [row.id, row]));
        if (productMap.size !== productIds.length) {
            throw new WarehouseError('Có sản phẩm không tồn tại hoặc đã tạm ẩn.', {
                code: 'INACTIVE_PRODUCT'
            });
        }

        const templateItems = await catalogRepo.listTemplateItems(client, serviceIds, productIds);
        const templateMap = new Map(templateItems.map(row => [
            `${row.service_id}:${row.product_id}`,
            Number(row.default_quantity)
        ]));

        return normalized.services.map(service => ({
            ...service,
            snapshot: serviceMap.get(service.service_id),
            items: service.items.map(item => ({
                ...item,
                product: productMap.get(item.product_id),
                template_quantity: templateMap.get(`${service.service_id}:${item.product_id}`) || null,
                item_source: templateMap.has(`${service.service_id}:${item.product_id}`)
                    ? 'TEMPLATE'
                    : 'MANUAL'
            }))
        }));
    }

    async function getAvailability(client, itemRows, { lock = false } = {}) {
        const totals = aggregateOrderItems(itemRows);
        const productIds = [...totals.keys()].sort();
        if (productIds.length === 0) {
            throw new WarehouseError('Đơn không còn sản phẩm để xuất.');
        }

        for (const productId of productIds) {
            await inventoryRepo.ensureBranchRows(client, productId);
        }

        const inventoryRows = await inventoryRepo.listStocks(client, productIds, { lock });
        const stocks = new Map();
        for (const row of inventoryRows) {
            if (!stocks.has(row.product_id)) {
                stocks.set(row.product_id, {
                    product_id: row.product_id,
                    product_name: row.product_name,
                    barcode: row.barcode,
                    US: 0,
                    UK: 0
                });
            }
            stocks.get(row.product_id)[row.branch] = Number(row.quantity);
        }

        const shortages = [];
        const allocations = [];
        for (const [productId, required] of totals) {
            const stock = stocks.get(productId);
            const totalStock = stock.US + stock.UK;
            if (totalStock < required) {
                shortages.push({
                    product_id: productId,
                    product_name: stock.product_name,
                    barcode: stock.barcode,
                    required,
                    stock_us: stock.US,
                    stock_uk: stock.UK,
                    missing: required - totalStock
                });
            }
            allocations.push({ ...stock, required });
        }
        return { totals, stocks, allocations, shortages };
    }

    async function enqueue(client, orderId, eventType, payload = {}) {
        await outboxRepo.enqueue(client, orderId, eventType, payload);
    }

    async function approveLockedOrder(client, order, actorContext) {
        if (order.status === WAREHOUSE_ORDER_STATUSES.APPROVED) {
            return { alreadyProcessed: true };
        }
        if (order.status !== WAREHOUSE_ORDER_STATUSES.PENDING) {
            throw new WarehouseError(`Đơn đang ở trạng thái ${order.status}, không thể duyệt.`, {
                status: 409,
                code: 'ORDER_NOT_PENDING'
            });
        }
        if (!actorContext.isAdmin && !actorContext.permissions.has('APPROVE_EXPORT')) {
            throw new WarehouseError('Bạn không có quyền duyệt đơn xuất kho trong nhóm này.', {
                status: 403,
                code: 'APPROVE_PERMISSION_REQUIRED'
            });
        }

        const orderItems = await orderRepo.listItems(client, order.id);
        const activeItems = orderItems.filter(item => !item.is_removed);
        const availability = await getAvailability(client, activeItems, { lock: true });
        if (availability.shortages.length) {
            throw new WarehouseError('Tổng tồn hai cơ sở không đủ để duyệt đơn.', {
                status: 409,
                code: 'INSUFFICIENT_STOCK',
                details: availability.shortages
            });
        }

        const otherBranch = order.branch === 'US' ? 'UK' : 'US';
        const requiresTransfer = availability.allocations.some(allocation =>
            allocation.required > allocation[order.branch]
        );
        if (requiresTransfer && !actorContext.isAdmin && !actorContext.permissions.has('APPROVE_TRANSFER')) {
            throw new WarehouseError('Đơn cần điều chuyển nhưng bạn chưa có quyền duyệt điều chuyển.', {
                status: 403,
                code: 'TRANSFER_PERMISSION_REQUIRED'
            });
        }

        const actor = {
            employeeId: actorContext.employee?.id || null,
            telegramId: actorContext.telegramId
        };

        let transfer = null;
        if (requiresTransfer) {
            transfer = await transferRepo.create(client, {
                transferCode: makeCode('TRF'),
                orderId: order.id,
                telegramGroupId: actorContext.group.telegram_group_id,
                fromBranch: otherBranch,
                toBranch: order.branch,
                actor
            });
        }

        for (const allocation of availability.allocations) {
            const localBefore = allocation[order.branch];
            const otherBefore = allocation[otherBranch];
            const localDeduct = Math.min(allocation.required, localBefore);
            const transferDeduct = allocation.required - localDeduct;
            const localAfter = localBefore - localDeduct;
            const otherAfter = otherBefore - transferDeduct;

            // Bước 1: trừ phần lấy được ngay tại cơ sở đang đứng.
            if (localDeduct > 0) {
                const truDuoc = await inventoryRepo.deduct(
                    client, allocation.product_id, order.branch, localDeduct
                );
                if (!truDuoc) {
                    throw new WarehouseError('Tồn kho vừa thay đổi, vui lòng duyệt lại.', {
                        status: 409,
                        code: 'CONCURRENT_STOCK_CHANGE'
                    });
                }
                await ledgerRepo.recordLocalExport(client, {
                    order,
                    productId: allocation.product_id,
                    branch: order.branch,
                    quantity: localDeduct,
                    balanceBefore: localBefore,
                    balanceAfter: localAfter,
                    actor
                });
            }

            // Bước 2: phần còn thiếu thì lấy bù từ cơ sở kia, dùng ngay cho khách.
            if (transferDeduct > 0) {
                const truDuoc = await inventoryRepo.deduct(
                    client, allocation.product_id, otherBranch, transferDeduct
                );
                if (!truDuoc) {
                    throw new WarehouseError('Tồn kho nguồn điều chuyển vừa thay đổi, vui lòng duyệt lại.', {
                        status: 409,
                        code: 'CONCURRENT_STOCK_CHANGE'
                    });
                }
                await transferRepo.addItem(client, transfer.id, allocation.product_id, transferDeduct);
                await ledgerRepo.recordTransferExport(client, {
                    order,
                    transferId: transfer.id,
                    productId: allocation.product_id,
                    fromBranch: otherBranch,
                    toBranch: order.branch,
                    quantity: transferDeduct,
                    fromBalanceBefore: otherBefore,
                    fromBalanceAfter: otherAfter,
                    toBalanceAfterLocal: localAfter,
                    actor
                });
            }

            let remainingLocal = localDeduct;
            const productItems = activeItems.filter(item => item.product_id === allocation.product_id);
            for (const item of productItems) {
                const quantity = Number(item.actual_quantity);
                const itemLocal = Math.min(quantity, remainingLocal);
                const itemTransfer = quantity - itemLocal;
                remainingLocal -= itemLocal;
                // Bước 3: ghi lại từng dòng hàng lấy bao nhiêu tại chỗ, bao nhiêu lấy bù.
                await orderRepo.setItemAllocation(client, item.id, {
                    localQuantity: itemLocal,
                    transferQuantity: itemTransfer,
                    transferFromBranch: itemTransfer > 0 ? otherBranch : null
                });
            }
        }

        // Bước 4: chốt trạng thái đơn và xếp việc báo Telegram + ghi Sheet vào hàng đợi.
        await orderRepo.markApproved(client, order.id, actor);
        await enqueue(client, order.id, 'ORDER_APPROVED', {
            has_transfer: requiresTransfer
        });
        await enqueue(client, order.id, 'SYNC_ORDER_SHEET');
        return { alreadyProcessed: false, requiresTransfer };
    }

    async function createOrder({ telegramId, chatId, input, submit = true }) {
        const normalized = validateOrderInput(input, { allowDraft: !submit });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
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
            if (duplicate) {
                await client.query('COMMIT');
                return repository.getOrderDetail(duplicate.id);
            }

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
                    await enqueue(client, order.id, 'ORDER_PENDING_APPROVAL', {
                        transfer_suggestions: transferSuggestions
                    });
                }
            }

            await client.query('COMMIT');
            return repository.getOrderDetail(order.id);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function approveOrder({ orderId, telegramId, chatId }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const actorContext = await getActorContext(client, telegramId, chatId);
            const order = await orderRepo.getForUpdate(client, orderId, actorContext.group.id);
            if (!order) throw new WarehouseError('Không tìm thấy đơn trong nhóm này.', { status: 404 });
            await approveLockedOrder(client, order, actorContext);
            await client.query('COMMIT');
            return repository.getOrderDetail(order.id);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function rejectOrder({ orderId, telegramId, chatId }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const actorContext = await getActorContext(client, telegramId, chatId);
            if (!actorContext.isAdmin && !actorContext.permissions.has('APPROVE_EXPORT')) {
                throw new WarehouseError('Bạn không có quyền từ chối đơn trong nhóm này.', {
                    status: 403
                });
            }
            const tuChoiDuoc = await orderRepo.markRejected(client, orderId, actorContext.group.id, {
                employeeId: actorContext.employee?.id || null,
                telegramId: actorContext.telegramId
            });
            if (!tuChoiDuoc) {
                const existing = await orderRepo.getStatus(client, orderId, actorContext.group.id);
                if (!existing) throw new WarehouseError('Không tìm thấy đơn.', { status: 404 });
                throw new WarehouseError(`Đơn đã được xử lý: ${existing.status}`, {
                    status: 409,
                    code: 'ORDER_NOT_PENDING'
                });
            }
            await enqueue(client, orderId, 'ORDER_REJECTED');
            await client.query('COMMIT');
            return repository.getOrderDetail(orderId);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function getAdminActorContext(client, groupId, adminId) {
        const group = await repository.getWarehouseGroupById(groupId, client);
        if (!group) {
            throw new WarehouseError('Không tìm thấy group kho đang hoạt động.', { status: 404 });
        }
        return {
            group,
            employee: null,
            permissions: new Set(),
            isAdmin: true,
            telegramId: `admin:${adminId}`
        };
    }

    async function approveOrderAsAdmin({ orderId, groupId, adminId }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const actorContext = await getAdminActorContext(client, groupId, adminId);
            const order = await orderRepo.getForUpdate(client, orderId, actorContext.group.id);
            if (!order) throw new WarehouseError('Không tìm thấy đơn trong group này.', { status: 404 });
            await approveLockedOrder(client, order, actorContext);
            await client.query('COMMIT');
            return repository.getOrderDetail(order.id);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function rejectOrderAsAdmin({ orderId, groupId, adminId }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await getAdminActorContext(client, groupId, adminId);
            const tuChoiDuoc = await orderRepo.markRejected(client, orderId, groupId, {
                employeeId: null,
                telegramId: `admin:${adminId}`
            });
            if (!tuChoiDuoc) {
                const existing = await orderRepo.getStatus(client, orderId, groupId);
                if (!existing) throw new WarehouseError('Không tìm thấy đơn.', { status: 404 });
                throw new WarehouseError(`Đơn đã được xử lý: ${existing.status}`, {
                    status: 409,
                    code: 'ORDER_NOT_PENDING'
                });
            }
            await enqueue(client, orderId, 'ORDER_REJECTED');
            await client.query('COMMIT');
            return repository.getOrderDetail(orderId);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function reverseOrder({ orderId, groupId, adminId }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const order = await orderRepo.getForUpdate(client, orderId, groupId);
            if (!order) {
                throw new WarehouseError('Không tìm thấy đơn trong nhóm này.', { status: 404 });
            }
            if (order.status === WAREHOUSE_ORDER_STATUSES.REVERSED) {
                await client.query('COMMIT');
                return repository.getOrderDetail(order.id);
            }
            if (order.status !== WAREHOUSE_ORDER_STATUSES.APPROVED) {
                throw new WarehouseError('Chỉ đơn đã duyệt mới có thể hoàn tác.', {
                    status: 409,
                    code: 'ORDER_NOT_APPROVED'
                });
            }

            const physicalMovements = await ledgerRepo.listPhysicalMovements(client, order.id);
            if (!physicalMovements.length) {
                throw new WarehouseError('Đơn không có bút toán kho vật lý để hoàn tác.', {
                    status: 409,
                    code: 'REVERSAL_LEDGER_NOT_FOUND'
                });
            }

            for (const movement of physicalMovements) {
                const inventoryRow = await inventoryRepo.getForUpdate(
                    client, movement.product_id, movement.branch
                );
                if (!inventoryRow) {
                    throw new WarehouseError('Không tìm thấy dòng tồn kho cần hoàn tác.', {
                        status: 409,
                        code: 'REVERSAL_INVENTORY_NOT_FOUND'
                    });
                }
                const before = Number(inventoryRow.quantity);
                const quantity = Number(movement.restore_quantity);
                const after = before + quantity;
                await inventoryRepo.setQuantity(client, movement.product_id, movement.branch, after);
                await ledgerRepo.recordReversal(client, {
                    order,
                    productId: movement.product_id,
                    branch: movement.branch,
                    quantity,
                    balanceBefore: before,
                    balanceAfter: after,
                    adminId,
                    sourceLedgerIds: movement.source_ledger_ids
                });
            }

            await orderRepo.markReversed(client, order.id, adminId);
            await transferRepo.markReversedByOrder(client, order.id);
            await enqueue(client, order.id, 'ORDER_REVERSED');
            await enqueue(client, order.id, 'SYNC_ORDER_REVERSAL_SHEET');
            await client.query('COMMIT');
            return repository.getOrderDetail(order.id);
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function suggestCustomer(phone) {
        const normalized = String(phone || '').trim();
        if (normalized.length < 4) return null;
        return catalogRepo.findLatestCustomerByPhone(pool, normalized);
    }

    async function authorizeActor({ telegramId, chatId, requireEmployee = false }) {
        return getActorContext(pool, telegramId, chatId, { requireEmployee });
    }

    return {
        repository,
        createOrder,
        approveOrder,
        rejectOrder,
        approveOrderAsAdmin,
        rejectOrderAsAdmin,
        reverseOrder,
        suggestCustomer,
        authorizeActor
    };
}
