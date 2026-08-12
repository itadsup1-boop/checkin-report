import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../../database/index.js';
import {
    WarehouseError,
    createWarehouseOrderService
} from '../../warehouse/index.js';

const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const groupTelegramId = `-999${String(Date.now()).slice(-9)}`;
const otherGroupTelegramId = `-997${String(Date.now()).slice(-9)}`;
const creatorTelegramId = `88${String(Date.now()).slice(-8)}1`;
const managerTelegramId = `88${String(Date.now()).slice(-8)}2`;
const adminTelegramId = `88${String(Date.now()).slice(-8)}3`;
const ids = {
    groupId: null,
    otherGroupId: null,
    creatorId: null,
    managerId: null,
    productId: null,
    serviceIds: [],
    orderIds: []
};

async function setup() {
    const group = await pool.query(
        `INSERT INTO telegram_groups
            (telegram_group_id, group_name, bot_role, is_active, is_deleted,
             warehouse_service_order_enabled)
         VALUES ($1, $2, 'warehouse', TRUE, FALSE, TRUE)
         RETURNING id`,
        [groupTelegramId, `Warehouse Integration ${suffix}`]
    );
    ids.groupId = group.rows[0].id;
    const otherGroup = await pool.query(
        `INSERT INTO telegram_groups
            (telegram_group_id, group_name, bot_role, is_active, is_deleted,
             warehouse_service_order_enabled)
         VALUES ($1, $2, 'warehouse', TRUE, FALSE, TRUE)
         RETURNING id`,
        [otherGroupTelegramId, `Warehouse Other Integration ${suffix}`]
    );
    ids.otherGroupId = otherGroup.rows[0].id;

    const creator = await pool.query(
        `INSERT INTO employees
            (employee_code, full_name, telegram_id, telegram_group_id,
             department, position, role, is_active)
         VALUES ($1, 'Nhân viên test kho', $2, $3, 'Warehouse', 'Staff', 'Nhân viên', TRUE)
         RETURNING id`,
        [`WH-CREATOR-${suffix}`, creatorTelegramId, groupTelegramId]
    );
    ids.creatorId = creator.rows[0].id;
    const manager = await pool.query(
        `INSERT INTO employees
            (employee_code, full_name, telegram_id, telegram_group_id,
             department, position, role, is_active)
         VALUES ($1, 'Quản lý test kho', $2, $3, 'Warehouse', 'Manager', 'Nhân viên', TRUE)
         RETURNING id`,
        [`WH-MANAGER-${suffix}`, managerTelegramId, groupTelegramId]
    );
    ids.managerId = manager.rows[0].id;

    await pool.query(
        `INSERT INTO tk_warehouse_permissions
            (employee_id, telegram_group_id, permission_code, is_active, granted_by_admin_id)
         VALUES
            ($1, $2, 'APPROVE_EXPORT', TRUE, 'integration-test'),
            ($1, $2, 'APPROVE_TRANSFER', TRUE, 'integration-test'),
            ($1, $2, 'AUTO_APPROVE_OWN_ORDER', TRUE, 'integration-test')`,
        [ids.managerId, groupTelegramId]
    );

    const product = await pool.query(
        `INSERT INTO tk_products (barcode, product_name, is_active)
         VALUES ($1, $2, TRUE)
         RETURNING id`,
        [`WH-TEST-${suffix}`, `Sản phẩm test ${suffix}`]
    );
    ids.productId = product.rows[0].id;
    await pool.query(
        `INSERT INTO tk_inventory (product_id, branch, quantity)
         VALUES ($1, 'UK', 2), ($1, 'US', 10)`,
        [ids.productId]
    );

    for (const [index, quantity] of [2, 3].entries()) {
        const service = await pool.query(
            `INSERT INTO tk_warehouse_services
                (service_code, service_name, display_order, created_by_admin_id, updated_by_admin_id)
             VALUES ($1, $2, $3, 'integration-test', 'integration-test')
             RETURNING id`,
            [
                `WH_SERVICE_${index}_${String(Date.now()).slice(-6)}_${Math.round(Math.random() * 999)}`,
                `Dịch vụ test ${index + 1}`,
                index
            ]
        );
        const serviceId = service.rows[0].id;
        ids.serviceIds.push(serviceId);
        await pool.query(
            `INSERT INTO tk_warehouse_service_products
                (service_id, product_id, default_quantity, display_order, updated_by_admin_id)
             VALUES ($1, $2, $3, 0, 'integration-test')`,
            [serviceId, ids.productId, quantity]
        );
    }
}

function orderInput(key, quantities = [2, 3]) {
    return {
        customer_name: 'Khách kiểm thử',
        customer_phone: '0900000000',
        branch: 'UK',
        idempotency_key: `${key}-${suffix}`,
        services: ids.serviceIds.map((serviceId, index) => ({
            service_id: serviceId,
            display_order: index,
            items: [{
                product_id: ids.productId,
                actual_quantity: quantities[index],
                display_order: 0
            }]
        }))
    };
}

async function remember(order) {
    if (order?.id && !ids.orderIds.includes(order.id)) ids.orderIds.push(order.id);
    return order;
}

async function cleanup() {
    try {
        const orders = await pool.query(
            'SELECT id FROM tk_warehouse_orders WHERE group_id = $1',
            [ids.groupId]
        );
        const orderIds = orders.rows.map(row => row.id);
        if (orderIds.length) {
            await pool.query(
                `DELETE FROM tk_warehouse_outbox
                 WHERE aggregate_type = 'WAREHOUSE_ORDER' AND aggregate_id = ANY($1::uuid[])`,
                [orderIds]
            );
            await pool.query('DELETE FROM tk_warehouse_ledger WHERE order_id = ANY($1::uuid[])', [orderIds]);
            const transfers = await pool.query(
                'SELECT id FROM tk_warehouse_transfers WHERE order_id = ANY($1::uuid[])',
                [orderIds]
            );
            const transferIds = transfers.rows.map(row => row.id);
            if (transferIds.length) {
                await pool.query(
                    'DELETE FROM tk_warehouse_transfer_items WHERE transfer_id = ANY($1::uuid[])',
                    [transferIds]
                );
                await pool.query('DELETE FROM tk_warehouse_transfers WHERE id = ANY($1::uuid[])', [transferIds]);
            }
            await pool.query('DELETE FROM tk_warehouse_orders WHERE id = ANY($1::uuid[])', [orderIds]);
        }
        if (ids.serviceIds.length) {
            await pool.query(
                'DELETE FROM tk_warehouse_template_audit WHERE service_id = ANY($1::uuid[])',
                [ids.serviceIds]
            );
            await pool.query(
                'DELETE FROM tk_warehouse_service_products WHERE service_id = ANY($1::uuid[])',
                [ids.serviceIds]
            );
            await pool.query('DELETE FROM tk_warehouse_services WHERE id = ANY($1::uuid[])', [ids.serviceIds]);
        }
        if (ids.productId) {
            await pool.query('DELETE FROM tk_inventory WHERE product_id = $1', [ids.productId]);
            await pool.query('DELETE FROM tk_products WHERE id = $1', [ids.productId]);
        }
        if (ids.groupId) {
            await pool.query('DELETE FROM tk_warehouse_permission_audit WHERE telegram_group_id = $1', [groupTelegramId]);
            await pool.query('DELETE FROM tk_warehouse_permissions WHERE telegram_group_id = $1', [groupTelegramId]);
            await pool.query('DELETE FROM employees WHERE id = ANY($1::uuid[])', [[ids.creatorId, ids.managerId].filter(Boolean)]);
            await pool.query('DELETE FROM telegram_groups WHERE id = $1', [ids.groupId]);
        }
        if (ids.otherGroupId) {
            await pool.query('DELETE FROM telegram_groups WHERE id = $1', [ids.otherGroupId]);
        }
    } finally {
        await pool.end();
    }
}

test('warehouse service order integration', async t => {
    await setup();
    t.after(cleanup);
    const service = createWarehouseOrderService({ pool, adminIds: [adminTelegramId] });

    await t.test('nhân viên nhóm kho này không truy cập được nhóm kho khác', async () => {
        await assert.rejects(
            service.createOrder({
                telegramId: creatorTelegramId,
                chatId: otherGroupTelegramId,
                input: orderInput('cross-group'),
                submit: true
            }),
            error => error instanceof WarehouseError
                && error.code === 'WAREHOUSE_GROUP_MEMBERSHIP_REQUIRED'
        );
    });

    await t.test('giữ hai dòng cùng sản phẩm theo hai dịch vụ và chờ duyệt', async () => {
        const order = await remember(await service.createOrder({
            telegramId: creatorTelegramId,
            chatId: groupTelegramId,
            input: orderInput('pending'),
            submit: true
        }));
        assert.equal(order.status, 'PENDING_APPROVAL');
        assert.equal(order.services.length, 2);
        assert.equal(order.services[0].items[0].actual_quantity, 2);
        assert.equal(order.services[1].items[0].actual_quantity, 3);
        const stock = await pool.query(
            'SELECT branch, quantity FROM tk_inventory WHERE product_id = $1 ORDER BY branch',
            [ids.productId]
        );
        assert.deepEqual(stock.rows.map(row => [row.branch, row.quantity]), [['UK', 2], ['US', 10]]);
        const pendingEvent = await pool.query(
            `SELECT payload
             FROM tk_warehouse_outbox
             WHERE aggregate_id = $1 AND event_type = 'ORDER_PENDING_APPROVAL'`,
            [order.id]
        );
        assert.deepEqual(pendingEvent.rows[0].payload.transfer_suggestions.map(item => ({
            product_name: item.product_name,
            from_branch: item.from_branch,
            to_branch: item.to_branch,
            quantity: item.quantity
        })), [{
            product_name: `Sản phẩm test ${suffix}`,
            from_branch: 'US',
            to_branch: 'UK',
            quantity: 3
        }]);
    });

    await t.test('duyệt nguyên tử, điều chuyển dùng ngay và không tồn âm', async () => {
        const order = await service.repository.getOrderDetail(ids.orderIds[0]);
        const approved = await service.approveOrder({
            orderId: order.id,
            telegramId: managerTelegramId,
            chatId: groupTelegramId
        });
        assert.equal(approved.status, 'APPROVED');
        assert.equal(approved.transfers.length, 1);
        assert.equal(approved.transfers[0].items[0].quantity, 3);
        const stock = await pool.query(
            'SELECT branch, quantity FROM tk_inventory WHERE product_id = $1 ORDER BY branch',
            [ids.productId]
        );
        assert.deepEqual(stock.rows.map(row => [row.branch, row.quantity]), [['UK', 0], ['US', 7]]);
        const ledger = await pool.query(
            `SELECT event_type, quantity_delta
             FROM tk_warehouse_ledger WHERE order_id = $1 ORDER BY created_at, event_type`,
            [order.id]
        );
        assert.equal(ledger.rows.length, 4);
        assert.equal(ledger.rows.reduce((sum, row) =>
            ['CUSTOMER_EXPORT'].includes(row.event_type) ? sum + Number(row.quantity_delta) : sum
        , 0), -5);
    });

    await t.test('idempotency không tạo/trừ đơn hai lần', async () => {
        const duplicate = await service.createOrder({
            telegramId: creatorTelegramId,
            chatId: groupTelegramId,
            input: orderInput('pending'),
            submit: true
        });
        assert.equal(duplicate.id, ids.orderIds[0]);
        const secondApproval = await service.approveOrder({
            orderId: duplicate.id,
            telegramId: managerTelegramId,
            chatId: groupTelegramId
        });
        assert.equal(secondApproval.status, 'APPROVED');
        const stock = await pool.query(
            'SELECT SUM(quantity)::int AS quantity FROM tk_inventory WHERE product_id = $1',
            [ids.productId]
        );
        assert.equal(stock.rows[0].quantity, 7);
    });

    await t.test('hai yêu cầu duyệt đồng thời chỉ trừ một lần', async () => {
        const pending = await remember(await service.createOrder({
            telegramId: creatorTelegramId,
            chatId: groupTelegramId,
            input: orderInput('concurrent', [1, 1]),
            submit: true
        }));
        const results = await Promise.allSettled([
            service.approveOrder({
                orderId: pending.id,
                telegramId: managerTelegramId,
                chatId: groupTelegramId
            }),
            service.approveOrder({
                orderId: pending.id,
                telegramId: managerTelegramId,
                chatId: groupTelegramId
            })
        ]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
        const stock = await pool.query(
            'SELECT SUM(quantity)::int AS quantity FROM tk_inventory WHERE product_id = $1',
            [ids.productId]
        );
        assert.equal(stock.rows[0].quantity, 5);
        const ledger = await pool.query(
            'SELECT COUNT(*)::int AS count FROM tk_warehouse_ledger WHERE order_id = $1',
            [pending.id]
        );
        assert.equal(ledger.rows[0].count, 3);
    });

    await t.test('quản lý tạo đơn được tự duyệt', async () => {
        const order = await remember(await service.createOrder({
            telegramId: managerTelegramId,
            chatId: groupTelegramId,
            input: orderInput('manager-own', [1, 1]),
            submit: true
        }));
        assert.equal(order.status, 'APPROVED');
        const stock = await pool.query(
            'SELECT SUM(quantity)::int AS quantity FROM tk_inventory WHERE product_id = $1',
            [ids.productId]
        );
        assert.equal(stock.rows[0].quantity, 3);
    });

    await t.test('chặn toàn bộ đơn khi tổng hai kho không đủ', async () => {
        await assert.rejects(
            service.createOrder({
                telegramId: creatorTelegramId,
                chatId: groupTelegramId,
                input: orderInput('insufficient', [50, 50]),
                submit: true
            }),
            error => error instanceof WarehouseError && error.code === 'INSUFFICIENT_STOCK'
        );
        const negative = await pool.query(
            'SELECT COUNT(*)::int AS count FROM tk_inventory WHERE product_id = $1 AND quantity < 0',
            [ids.productId]
        );
        assert.equal(negative.rows[0].count, 0);
    });

    await t.test('hoàn tác bằng bút toán đảo, cộng trả đúng kho vật lý và chỉ một lần', async () => {
        const reversed = await service.reverseOrder({
            orderId: ids.orderIds[0],
            groupId: ids.groupId,
            adminId: 'integration-admin'
        });
        assert.equal(reversed.status, 'REVERSED');
        assert.equal(reversed.transfers[0].status, 'REVERSED');

        const stock = await pool.query(
            'SELECT branch, quantity FROM tk_inventory WHERE product_id = $1 ORDER BY branch',
            [ids.productId]
        );
        assert.deepEqual(stock.rows.map(row => [row.branch, row.quantity]), [['UK', 2], ['US', 6]]);

        const reversals = await pool.query(
            `SELECT branch, quantity_delta, actor_telegram_id
             FROM tk_warehouse_ledger
             WHERE order_id = $1 AND event_type = 'REVERSAL'
             ORDER BY branch`,
            [ids.orderIds[0]]
        );
        assert.deepEqual(
            reversals.rows.map(row => [row.branch, row.quantity_delta, row.actor_telegram_id]),
            [['UK', 2, 'admin:integration-admin'], ['US', 3, 'admin:integration-admin']]
        );

        await service.reverseOrder({
            orderId: ids.orderIds[0],
            groupId: ids.groupId,
            adminId: 'integration-admin'
        });
        const afterRetry = await pool.query(
            'SELECT SUM(quantity)::int AS quantity FROM tk_inventory WHERE product_id = $1',
            [ids.productId]
        );
        assert.equal(afterRetry.rows[0].quantity, 8);
    });

    await t.test('Telegram Admin chưa đăng ký nhân viên vẫn tạo và tự duyệt đơn', async () => {
        const order = await remember(await service.createOrder({
            telegramId: adminTelegramId,
            chatId: groupTelegramId,
            input: orderInput('telegram-admin', [1, 1]),
            submit: true
        }));
        assert.equal(order.status, 'APPROVED');
        assert.equal(order.created_by, null);
        assert.equal(order.created_by_telegram_id, adminTelegramId);
        assert.equal(order.creator_name, 'Admin');
    });

    await t.test('Web Admin duyệt hoặc từ chối đơn không cần tài khoản nhân viên', async () => {
        const pendingToApprove = await remember(await service.createOrder({
            telegramId: creatorTelegramId,
            chatId: groupTelegramId,
            input: orderInput('web-admin-approve', [1, 1]),
            submit: true
        }));
        const approved = await service.approveOrderAsAdmin({
            orderId: pendingToApprove.id,
            groupId: ids.groupId,
            adminId: 'web-admin-1'
        });
        assert.equal(approved.status, 'APPROVED');
        assert.equal(approved.approved_by, null);
        assert.equal(approved.approved_by_telegram_id, 'admin:web-admin-1');

        const pendingToReject = await remember(await service.createOrder({
            telegramId: creatorTelegramId,
            chatId: groupTelegramId,
            input: orderInput('web-admin-reject', [1, 1]),
            submit: true
        }));
        const rejected = await service.rejectOrderAsAdmin({
            orderId: pendingToReject.id,
            groupId: ids.groupId,
            adminId: 'web-admin-1'
        });
        assert.equal(rejected.status, 'REJECTED');
        assert.equal(rejected.rejected_by_telegram_id, 'admin:web-admin-1');
    });

});
