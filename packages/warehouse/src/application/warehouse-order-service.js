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
        const servicesResult = await client.query(
            `SELECT id, service_code, service_name
             FROM tk_warehouse_services
             WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
            [serviceIds]
        );
        const serviceMap = new Map(servicesResult.rows.map(row => [row.id, row]));
        if (serviceMap.size !== new Set(serviceIds).size) {
            throw new WarehouseError('Có dịch vụ không tồn tại hoặc đã tạm ẩn.', {
                code: 'INACTIVE_SERVICE'
            });
        }

        const productIds = [...new Set(normalized.services.flatMap(service =>
            service.items.map(item => item.product_id)
        ))];
        const productsResult = await client.query(
            `SELECT id, barcode, product_name
             FROM tk_products
             WHERE id = ANY($1::uuid[]) AND is_active = TRUE`,
            [productIds]
        );
        const productMap = new Map(productsResult.rows.map(row => [row.id, row]));
        if (productMap.size !== productIds.length) {
            throw new WarehouseError('Có sản phẩm không tồn tại hoặc đã tạm ẩn.', {
                code: 'INACTIVE_PRODUCT'
            });
        }

        const templateResult = await client.query(
            `SELECT service_id, product_id, default_quantity
             FROM tk_warehouse_service_products
             WHERE service_id = ANY($1::uuid[])
               AND product_id = ANY($2::uuid[])
               AND is_active = TRUE`,
            [serviceIds, productIds]
        );
        const templateMap = new Map(templateResult.rows.map(row => [
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
            await client.query(
                `INSERT INTO tk_inventory (product_id, branch, quantity, updated_at)
                 VALUES ($1, 'US', 0, NOW()), ($1, 'UK', 0, NOW())
                 ON CONFLICT (product_id, branch) DO NOTHING`,
                [productId]
            );
        }

        const inventoryResult = await client.query(
            `SELECT i.product_id, i.branch, i.quantity, p.product_name, p.barcode
             FROM tk_inventory i
             JOIN tk_products p ON p.id = i.product_id
             WHERE i.product_id = ANY($1::uuid[])
             ORDER BY i.product_id, i.branch
             ${lock ? 'FOR UPDATE OF i' : ''}`,
            [productIds]
        );
        const stocks = new Map();
        for (const row of inventoryResult.rows) {
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
        await client.query(
            `INSERT INTO tk_warehouse_outbox
                (aggregate_type, aggregate_id, event_type, payload)
             VALUES ('WAREHOUSE_ORDER', $1, $2, $3::jsonb)
             ON CONFLICT (aggregate_type, aggregate_id, event_type) DO NOTHING`,
            [orderId, eventType, JSON.stringify(payload)]
        );
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

        const itemsResult = await client.query(
            `SELECT oi.id, oi.product_id, oi.actual_quantity, oi.is_removed,
                    oi.display_order, os.display_order AS service_display_order
             FROM tk_warehouse_order_items oi
             JOIN tk_warehouse_order_services os ON os.id = oi.order_service_id
             WHERE os.order_id = $1
             ORDER BY os.display_order, oi.display_order, oi.id`,
            [order.id]
        );
        const activeItems = itemsResult.rows.filter(item => !item.is_removed);
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

        let transfer = null;
        if (requiresTransfer) {
            const transferResult = await client.query(
                `INSERT INTO tk_warehouse_transfers
                    (transfer_code, order_id, telegram_group_id, from_branch, to_branch,
                     status, confirmed_by, confirmed_by_telegram_id, confirmed_at)
                 VALUES ($1, $2, $3, $4, $5, 'NOTIFIED', $6, $7, NOW())
                 RETURNING *`,
                [
                    makeCode('TRF'),
                    order.id,
                    actorContext.group.telegram_group_id,
                    otherBranch,
                    order.branch,
                    actorContext.employee?.id || null,
                    actorContext.telegramId
                ]
            );
            transfer = transferResult.rows[0];
        }

        for (const allocation of availability.allocations) {
            const localBefore = allocation[order.branch];
            const otherBefore = allocation[otherBranch];
            const localDeduct = Math.min(allocation.required, localBefore);
            const transferDeduct = allocation.required - localDeduct;
            const localAfter = localBefore - localDeduct;
            const otherAfter = otherBefore - transferDeduct;

            if (localDeduct > 0) {
                const update = await client.query(
                    `UPDATE tk_inventory
                     SET quantity = quantity - $3, updated_at = NOW()
                     WHERE product_id = $1 AND branch = $2 AND quantity >= $3`,
                    [allocation.product_id, order.branch, localDeduct]
                );
                if (update.rowCount !== 1) {
                    throw new WarehouseError('Tồn kho vừa thay đổi, vui lòng duyệt lại.', {
                        status: 409,
                        code: 'CONCURRENT_STOCK_CHANGE'
                    });
                }
                await client.query(
                    `INSERT INTO tk_warehouse_ledger
                        (event_key, event_type, order_id, group_id, product_id, branch,
                         quantity_delta, balance_before, balance_after,
                         actor_employee_id, actor_telegram_id,
                         approved_by_employee_id, metadata)
                     VALUES ($1, 'CUSTOMER_EXPORT', $2, $3, $4, $5,
                             $6, $7, $8, $9, $10, $9, $11::jsonb)`,
                    [
                        `${order.id}:${allocation.product_id}:customer-local`,
                        order.id,
                        order.group_id,
                        allocation.product_id,
                        order.branch,
                        -localDeduct,
                        localBefore,
                        localAfter,
                        actorContext.employee?.id || null,
                        actorContext.telegramId,
                        JSON.stringify({ allocation: 'LOCAL' })
                    ]
                );
            }

            if (transferDeduct > 0) {
                const update = await client.query(
                    `UPDATE tk_inventory
                     SET quantity = quantity - $3, updated_at = NOW()
                     WHERE product_id = $1 AND branch = $2 AND quantity >= $3`,
                    [allocation.product_id, otherBranch, transferDeduct]
                );
                if (update.rowCount !== 1) {
                    throw new WarehouseError('Tồn kho nguồn điều chuyển vừa thay đổi, vui lòng duyệt lại.', {
                        status: 409,
                        code: 'CONCURRENT_STOCK_CHANGE'
                    });
                }
                await client.query(
                    `INSERT INTO tk_warehouse_transfer_items (transfer_id, product_id, quantity)
                     VALUES ($1, $2, $3)`,
                    [transfer.id, allocation.product_id, transferDeduct]
                );
                await client.query(
                    `INSERT INTO tk_warehouse_ledger
                        (event_key, event_type, order_id, transfer_id, group_id, product_id,
                         branch, quantity_delta, balance_before, balance_after,
                         actor_employee_id, actor_telegram_id,
                         approved_by_employee_id, metadata)
                     VALUES
                        ($1, 'TRANSFER_OUT', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $12::jsonb),
                        ($13, 'TRANSFER_IN_DIRECT_USE', $2, $3, $4, $5, $14, $15, $16, $17, $10, $11, $10, $18::jsonb),
                        ($19, 'CUSTOMER_EXPORT', $2, $3, $4, $5, $14, $20, $17, $16, $10, $11, $10, $21::jsonb)`,
                    [
                        `${order.id}:${allocation.product_id}:transfer-out`,
                        order.id,
                        transfer.id,
                        order.group_id,
                        allocation.product_id,
                        otherBranch,
                        -transferDeduct,
                        otherBefore,
                        otherAfter,
                        actorContext.employee?.id || null,
                        actorContext.telegramId,
                        JSON.stringify({ to_branch: order.branch, direct_use: true }),
                        `${order.id}:${allocation.product_id}:transfer-in`,
                        order.branch,
                        transferDeduct,
                        localAfter,
                        localAfter + transferDeduct,
                        JSON.stringify({ from_branch: otherBranch, direct_use: true, virtual_balance: true }),
                        `${order.id}:${allocation.product_id}:customer-transfer`,
                        -transferDeduct,
                        JSON.stringify({ allocation: 'TRANSFER', from_branch: otherBranch, virtual_balance: true })
                    ]
                );
            }

            let remainingLocal = localDeduct;
            const productItems = activeItems.filter(item => item.product_id === allocation.product_id);
            for (const item of productItems) {
                const quantity = Number(item.actual_quantity);
                const itemLocal = Math.min(quantity, remainingLocal);
                const itemTransfer = quantity - itemLocal;
                remainingLocal -= itemLocal;
                await client.query(
                    `UPDATE tk_warehouse_order_items
                     SET local_allocated_quantity = $2,
                         transfer_allocated_quantity = $3,
                         transfer_from_branch = $4
                     WHERE id = $1`,
                    [
                        item.id,
                        itemLocal,
                        itemTransfer,
                        itemTransfer > 0 ? otherBranch : null
                    ]
                );
            }
        }

        await client.query(
            `UPDATE tk_warehouse_orders
             SET status = 'APPROVED', approved_by = $2,
                 approved_by_telegram_id = $3, approved_at = NOW(),
                 updated_at = NOW(), sync_status = 'PENDING'
             WHERE id = $1`,
            [order.id, actorContext.employee?.id || null, actorContext.telegramId]
        );
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

            const duplicate = await client.query(
                `SELECT id FROM tk_warehouse_orders
                 WHERE group_id = $1 AND idempotency_key = $2`,
                [actorContext.group.id, normalized.idempotency_key]
            );
            if (duplicate.rows[0]) {
                await client.query('COMMIT');
                return repository.getOrderDetail(duplicate.rows[0].id);
            }

            const graph = await validateAndSnapshotGraph(client, normalized);
            const status = submit
                ? WAREHOUSE_ORDER_STATUSES.PENDING
                : WAREHOUSE_ORDER_STATUSES.DRAFT;
            const orderResult = await client.query(
                `INSERT INTO tk_warehouse_orders
                    (order_code, group_id, created_by, created_by_telegram_id,
                     customer_name, customer_phone, branch, status,
                     idempotency_key, telegram_chat_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                 RETURNING *`,
                [
                    makeCode('ORD'),
                    actorContext.group.id,
                    actorContext.employee?.id || null,
                    actorContext.telegramId,
                    normalized.customer_name,
                    normalized.customer_phone,
                    normalized.branch,
                    status,
                    normalized.idempotency_key,
                    String(chatId)
                ]
            );
            const order = orderResult.rows[0];
            const insertedItems = [];
            for (const service of graph) {
                const orderService = await client.query(
                    `INSERT INTO tk_warehouse_order_services
                        (order_id, service_id, service_code_snapshot,
                         service_name_snapshot, display_order)
                     VALUES ($1, $2, $3, $4, $5)
                     RETURNING id`,
                    [
                        order.id,
                        service.service_id,
                        service.snapshot.service_code,
                        service.snapshot.service_name,
                        service.display_order
                    ]
                );
                for (const item of service.items) {
                    const inserted = await client.query(
                        `INSERT INTO tk_warehouse_order_items
                            (order_service_id, product_id, product_name_snapshot,
                             barcode_snapshot, template_quantity, actual_quantity,
                             item_source, is_removed, display_order)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                         RETURNING id, product_id, actual_quantity, is_removed`,
                        [
                            orderService.rows[0].id,
                            item.product_id,
                            item.product.product_name,
                            item.product.barcode,
                            item.template_quantity,
                            item.actual_quantity,
                            item.item_source,
                            item.is_removed,
                            item.display_order
                        ]
                    );
                    insertedItems.push(inserted.rows[0]);
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
            const orderResult = await client.query(
                `SELECT * FROM tk_warehouse_orders
                 WHERE id = $1 AND group_id = $2
                 FOR UPDATE`,
                [orderId, actorContext.group.id]
            );
            const order = orderResult.rows[0];
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
            const result = await client.query(
                `UPDATE tk_warehouse_orders
                 SET status = 'REJECTED', rejected_by = $3,
                     rejected_by_telegram_id = $4, rejected_at = NOW(),
                     updated_at = NOW(), sync_status = 'PENDING'
                 WHERE id = $1 AND group_id = $2 AND status = 'PENDING_APPROVAL'
                 RETURNING id`,
                [orderId, actorContext.group.id, actorContext.employee?.id || null, actorContext.telegramId]
            );
            if (!result.rows[0]) {
                const existing = await client.query(
                    'SELECT status FROM tk_warehouse_orders WHERE id = $1 AND group_id = $2',
                    [orderId, actorContext.group.id]
                );
                if (!existing.rows[0]) throw new WarehouseError('Không tìm thấy đơn.', { status: 404 });
                throw new WarehouseError(`Đơn đã được xử lý: ${existing.rows[0].status}`, {
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
        const result = await client.query(
            `SELECT id, telegram_group_id, group_name, bot_role,
                    warehouse_service_order_enabled
             FROM telegram_groups
             WHERE id = $1 AND bot_role = 'warehouse'
               AND is_active = TRUE AND COALESCE(is_deleted, FALSE) = FALSE
             LIMIT 1`,
            [groupId]
        );
        if (!result.rows[0]) {
            throw new WarehouseError('Không tìm thấy group kho đang hoạt động.', { status: 404 });
        }
        return {
            group: result.rows[0],
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
            const result = await client.query(
                `SELECT * FROM tk_warehouse_orders
                 WHERE id = $1 AND group_id = $2
                 FOR UPDATE`,
                [orderId, actorContext.group.id]
            );
            const order = result.rows[0];
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
            const result = await client.query(
                `UPDATE tk_warehouse_orders
                 SET status = 'REJECTED', rejected_by = NULL,
                     rejected_by_telegram_id = $3, rejected_at = NOW(),
                     updated_at = NOW(), sync_status = 'PENDING'
                 WHERE id = $1 AND group_id = $2 AND status = 'PENDING_APPROVAL'
                 RETURNING id`,
                [orderId, groupId, `admin:${adminId}`]
            );
            if (!result.rows[0]) {
                const existing = await client.query(
                    'SELECT status FROM tk_warehouse_orders WHERE id = $1 AND group_id = $2',
                    [orderId, groupId]
                );
                if (!existing.rows[0]) throw new WarehouseError('Không tìm thấy đơn.', { status: 404 });
                throw new WarehouseError(`Đơn đã được xử lý: ${existing.rows[0].status}`, {
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
            const orderResult = await client.query(
                `SELECT * FROM tk_warehouse_orders
                 WHERE id = $1 AND group_id = $2
                 FOR UPDATE`,
                [orderId, groupId]
            );
            const order = orderResult.rows[0];
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

            const physicalMovements = await client.query(
                `SELECT product_id, branch,
                        SUM(-quantity_delta)::int AS restore_quantity,
                        ARRAY_AGG(id ORDER BY created_at, id) AS source_ledger_ids
                 FROM tk_warehouse_ledger
                 WHERE order_id = $1
                   AND event_type IN ('CUSTOMER_EXPORT', 'TRANSFER_OUT')
                   AND quantity_delta < 0
                   AND COALESCE(metadata->>'virtual_balance', 'false') <> 'true'
                 GROUP BY product_id, branch
                 ORDER BY product_id, branch`,
                [order.id]
            );
            if (!physicalMovements.rows.length) {
                throw new WarehouseError('Đơn không có bút toán kho vật lý để hoàn tác.', {
                    status: 409,
                    code: 'REVERSAL_LEDGER_NOT_FOUND'
                });
            }

            for (const movement of physicalMovements.rows) {
                const inventoryResult = await client.query(
                    `SELECT quantity
                     FROM tk_inventory
                     WHERE product_id = $1 AND branch = $2
                     FOR UPDATE`,
                    [movement.product_id, movement.branch]
                );
                if (!inventoryResult.rows[0]) {
                    throw new WarehouseError('Không tìm thấy dòng tồn kho cần hoàn tác.', {
                        status: 409,
                        code: 'REVERSAL_INVENTORY_NOT_FOUND'
                    });
                }
                const before = Number(inventoryResult.rows[0].quantity);
                const quantity = Number(movement.restore_quantity);
                const after = before + quantity;
                await client.query(
                    `UPDATE tk_inventory
                     SET quantity = $3, updated_at = NOW()
                     WHERE product_id = $1 AND branch = $2`,
                    [movement.product_id, movement.branch, after]
                );
                await client.query(
                    `INSERT INTO tk_warehouse_ledger
                        (event_key, event_type, order_id, group_id, product_id, branch,
                         quantity_delta, balance_before, balance_after,
                         actor_employee_id, actor_telegram_id, metadata)
                     VALUES ($1, 'REVERSAL', $2, $3, $4, $5,
                             $6, $7, $8, NULL, $9, $10::jsonb)`,
                    [
                        `${order.id}:${movement.product_id}:${movement.branch}:reversal`,
                        order.id,
                        order.group_id,
                        movement.product_id,
                        movement.branch,
                        quantity,
                        before,
                        after,
                        `admin:${adminId}`,
                        JSON.stringify({
                            reason: 'ADMIN_CORRECTION',
                            actor_admin_id: String(adminId),
                            source_ledger_ids: movement.source_ledger_ids
                        })
                    ]
                );
            }

            await client.query(
                `UPDATE tk_warehouse_orders
                 SET status = 'REVERSED', reversed_by_admin_id = $2,
                     reversed_at = NOW(), sync_status = 'PENDING', updated_at = NOW()
                 WHERE id = $1`,
                [order.id, String(adminId)]
            );
            await client.query(
                `UPDATE tk_warehouse_transfers
                 SET status = 'REVERSED'
                 WHERE order_id = $1`,
                [order.id]
            );
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
        const result = await pool.query(
            `SELECT customer_name, customer_phone, created_at
             FROM tk_warehouse_orders
             WHERE customer_phone = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [normalized]
        );
        return result.rows[0] || null;
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
