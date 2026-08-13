import test from 'node:test';
import assert from 'node:assert/strict';
import { registerWarehouseAdminRoutes } from '../index.js';

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

    // So sánh theo tập đã sắp xếp thay vì theo thứ tự đăng ký.
    //
    // Route giờ được gom theo nhóm nghiệp vụ (dịch vụ / sản phẩm / quyền / đơn /
    // vận hành) nên thứ tự khác bản cũ. Việc này an toàn vì không có cặp route nào
    // che khuất nhau — đã đối chiếu từng cặp cùng method và cùng số đoạn đường dẫn.
    // Phép so sánh vẫn chặt: thiếu hoặc thừa một route là fail ngay.
    assert.deepEqual(
        routes.map(route => `${route.method} ${route.path}`).sort(),
        [
            'GET /api/admin/warehouse/groups/:groupId/ledger',
            'GET /api/admin/warehouse/groups/:groupId/orders',
            'GET /api/admin/warehouse/groups/:groupId/outbox',
            'GET /api/admin/warehouse/groups/:groupId/permission-audit',
            'GET /api/admin/warehouse/groups/:groupId/permissions',
            'GET /api/admin/warehouse/products',
            'GET /api/admin/warehouse/products/audit',
            'GET /api/admin/warehouse/services',
            'GET /api/admin/warehouse/services/:serviceId/audit',
            'GET /api/admin/warehouse/services/:serviceId/products',
            'POST /api/admin/warehouse/groups/:groupId/orders/:orderId/approve',
            'POST /api/admin/warehouse/groups/:groupId/orders/:orderId/reject',
            'POST /api/admin/warehouse/groups/:groupId/orders/:orderId/reverse',
            'POST /api/admin/warehouse/groups/:groupId/outbox/:eventId/retry',
            'POST /api/admin/warehouse/services',
            'PUT /api/admin/warehouse/groups/:groupId/feature-flag',
            'PUT /api/admin/warehouse/groups/:groupId/permissions/:employeeId',
            'PUT /api/admin/warehouse/products/:productId',
            'PUT /api/admin/warehouse/services/:serviceId',
            'PUT /api/admin/warehouse/services/:serviceId/products'
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
