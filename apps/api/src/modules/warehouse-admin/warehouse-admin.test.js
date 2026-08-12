import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWarehouseAdminRoutes } from './index.js';

test('Warehouse Admin đăng ký đầy đủ API và từ chối request thiếu phiên Admin', async () => {
    const routes = [];
    const app = {};
    for (const method of ['get', 'post', 'put']) {
        app[method] = (path, ...handlers) => routes.push({
            method: method.toUpperCase(),
            path,
            handlers
        });
    }
    const pool = {
        async query() {
            throw new Error('Không được query DB trong lúc đăng ký route');
        },
        async connect() {
            throw new Error('Không được connect DB trong lúc đăng ký route');
        }
    };

    registerWarehouseAdminRoutes({ app, pool });

    assert.deepEqual(
        routes.map(route => `${route.method} ${route.path}`),
        [
            'GET /api/admin/warehouse/services',
            'POST /api/admin/warehouse/services',
            'PUT /api/admin/warehouse/services/:serviceId',
            'GET /api/admin/warehouse/products',
            'PUT /api/admin/warehouse/products/:productId',
            'GET /api/admin/warehouse/products/audit',
            'GET /api/admin/warehouse/services/:serviceId/products',
            'PUT /api/admin/warehouse/services/:serviceId/products',
            'GET /api/admin/warehouse/services/:serviceId/audit',
            'GET /api/admin/warehouse/groups/:groupId/permissions',
            'PUT /api/admin/warehouse/groups/:groupId/permissions/:employeeId',
            'GET /api/admin/warehouse/groups/:groupId/permission-audit',
            'PUT /api/admin/warehouse/groups/:groupId/feature-flag',
            'GET /api/admin/warehouse/groups/:groupId/orders',
            'POST /api/admin/warehouse/groups/:groupId/orders/:orderId/approve',
            'POST /api/admin/warehouse/groups/:groupId/orders/:orderId/reject',
            'POST /api/admin/warehouse/groups/:groupId/orders/:orderId/reverse',
            'GET /api/admin/warehouse/groups/:groupId/ledger',
            'GET /api/admin/warehouse/groups/:groupId/outbox',
            'POST /api/admin/warehouse/groups/:groupId/outbox/:eventId/retry'
        ]
    );
    assert.ok(routes.every(route => route.handlers.length === 1));

    const servicesRoute = routes.find(route =>
        route.method === 'GET' && route.path === '/api/admin/warehouse/services'
    );
    let statusCode = 200;
    let body;
    const response = {
        status(value) {
            statusCode = value;
            return this;
        },
        json(value) {
            body = value;
            return value;
        }
    };
    await servicesRoute.handlers[0]({ headers: {}, query: {} }, response);
    assert.equal(statusCode, 401);
    assert.equal(body.success, false);
});
