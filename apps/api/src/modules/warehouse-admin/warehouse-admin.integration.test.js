import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../../../../../packages/database/index.js';
import { registerWarehouseAdminRoutes } from './index.js';

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(value) {
            this.statusCode = value;
            return this;
        },
        json(value) {
            this.body = value;
            return value;
        }
    };
}

test('các truy vấn đọc Warehouse Admin chạy được trên schema thật', async t => {
    let catalogServiceId;
    let catalogProductId;
    t.after(async () => {
        if (catalogServiceId) {
            await pool.query('DELETE FROM tk_warehouse_template_audit WHERE service_id = $1', [catalogServiceId]);
            await pool.query('DELETE FROM tk_warehouse_service_products WHERE service_id = $1', [catalogServiceId]);
            await pool.query('DELETE FROM tk_warehouse_services WHERE id = $1', [catalogServiceId]);
        }
        if (catalogProductId) {
            await pool.query('DELETE FROM tk_inventory WHERE product_id = $1', [catalogProductId]);
            await pool.query('DELETE FROM tk_products WHERE id = $1', [catalogProductId]);
        }
        await pool.end();
    });
    const groupResult = await pool.query(
        `SELECT telegram_group_id
         FROM telegram_groups
         WHERE bot_role = 'warehouse' AND is_active = TRUE
           AND COALESCE(is_deleted, FALSE) = FALSE
         ORDER BY created_at
         LIMIT 1`
    );
    if (!groupResult.rows[0]) {
        t.skip('Database không có group warehouse để kiểm tra truy vấn đọc.');
        return;
    }
    const groupId = String(groupResult.rows[0].telegram_group_id);
    const routes = new Map();
    const app = {};
    for (const method of ['get', 'post', 'put']) {
        app[method] = (path, handler) => routes.set(`${method.toUpperCase()} ${path}`, handler);
    }
    registerWarehouseAdminRoutes({ app, pool });
    const headers = { 'x-admin-id': 'super-admin-id', 'x-admin-role': 'SUPER_ADMIN' };
    const readCases = [
        ['GET /api/admin/warehouse/services', { headers, query: {} }, 'services'],
        ['GET /api/admin/warehouse/products', { headers, query: {} }, 'products'],
        ['GET /api/admin/warehouse/products/audit', { headers, query: {} }, 'audit'],
        [`GET /api/admin/warehouse/groups/:groupId/permissions`, { headers, params: { groupId } }, 'employees'],
        [`GET /api/admin/warehouse/groups/:groupId/permission-audit`, { headers, params: { groupId } }, 'audit'],
        [`GET /api/admin/warehouse/groups/:groupId/orders`, { headers, params: { groupId } }, 'orders'],
        [`GET /api/admin/warehouse/groups/:groupId/ledger`, { headers, params: { groupId }, query: {} }, 'ledger'],
        [`GET /api/admin/warehouse/groups/:groupId/outbox`, { headers, params: { groupId } }, 'events']
    ];

    for (const [routeKey, req, arrayKey] of readCases) {
        const response = createResponse();
        await routes.get(routeKey)(req, response);
        assert.equal(response.statusCode, 200, `${routeKey}: ${response.body?.message || ''}`);
        assert.equal(response.body?.success, true, routeKey);
        assert.ok(Array.isArray(response.body?.[arrayKey]), routeKey);
    }

    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const productResult = await pool.query(
        `INSERT INTO tk_products (barcode, product_name)
         VALUES ($1, $2)
         RETURNING id`,
        [`ADMIN-CATALOG-${suffix}`, `Mặt hàng mẫu ${suffix}`]
    );
    catalogProductId = productResult.rows[0].id;

    const createResponseValue = createResponse();
    await routes.get('POST /api/admin/warehouse/services')({
        headers,
        body: {
            service_code: `ADMIN_${String(Date.now()).slice(-10)}`,
            service_name: `Dịch vụ mẫu ${suffix}`
        }
    }, createResponseValue);
    assert.equal(createResponseValue.statusCode, 201, createResponseValue.body?.message);
    catalogServiceId = createResponseValue.body.service.id;
    assert.equal(createResponseValue.body.data.service.id, catalogServiceId);

    const replaceTemplate = routes.get('PUT /api/admin/warehouse/services/:serviceId/products');
    const addResponse = createResponse();
    await replaceTemplate({
        headers,
        params: { serviceId: catalogServiceId },
        body: { items: [{ product_id: catalogProductId, default_quantity: 2 }] }
    }, addResponse);
    assert.equal(addResponse.statusCode, 200, addResponse.body?.message);

    const removeResponse = createResponse();
    await replaceTemplate({
        headers,
        params: { serviceId: catalogServiceId },
        body: { items: [] }
    }, removeResponse);
    assert.equal(removeResponse.statusCode, 200, removeResponse.body?.message);
    const removed = await pool.query(
        `SELECT is_active
         FROM tk_warehouse_service_products
         WHERE service_id = $1 AND product_id = $2`,
        [catalogServiceId, catalogProductId]
    );
    assert.equal(removed.rows[0]?.is_active, false, 'Mặt hàng bỏ khỏi mẫu phải được vô hiệu hóa');
});
