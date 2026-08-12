import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerWarehouseModule } from './index.js';
import { WAREHOUSE_IMAGE_LIMITS } from './http/warehouse-image-upload.js';

function createRegistrationHarness() {
    const routes = [];
    const actions = [];
    const events = [];
    let queryCount = 0;

    const botApp = {
        get(path, ...handlers) {
            routes.push({ method: 'GET', path, handlers });
        },
        post(path, ...handlers) {
            routes.push({ method: 'POST', path, handlers });
        }
    };

    const bot = {
        action(pattern, handler) {
            actions.push({ pattern: pattern.toString(), handler });
        },
        on(eventNames, handler) {
            events.push({ eventNames, handler });
        }
    };

    const middleware = (req, res, next) => next();
    const moduleApi = registerWarehouseModule({
        botApp,
        bot,
        pool: {
            async query() {
                queryCount += 1;
                throw new Error('Database must not be queried while registering module');
            }
        },
        authenticateTelegramMiniApp: middleware,
        receiveWarehouseImages: middleware,
        moment: () => ({ utcOffset: () => ({ format: () => '' }) }),
        fs: {},
        createWarehouseFolder: async () => ({}),
        uploadToDrive: async () => ({}),
        escapeHtml: value => String(value),
        getDocById: async () => null
        ,
        enableBackgroundWorkers: false
    });

    return {
        routes,
        actions,
        events,
        queryCount,
        moduleApi
    };
}

test('module kho đăng ký đủ endpoint cũ và không truy cập database lúc khởi động', () => {
    const harness = createRegistrationHarness();

    assert.deepEqual(
        harness.routes.map(route => `${route.method} ${route.path}`),
        [
            'GET /api/products/by-barcode/:barcode',
            'GET /api/warehouse/products',
            'GET /api/warehouse/inventory',
            'GET /api/warehouse/check-stock',
            'POST /api/warehouse/import',
            'POST /api/warehouse/export/request',
            'GET /api/warehouse/config',
            'GET /api/warehouse/service-order/bootstrap',
            'GET /api/warehouse/customers/suggestion',
            'POST /api/warehouse/service-orders',
            'GET /api/warehouse/service-orders/:orderId',
            'POST /api/warehouse/service-orders/:orderId/approve',
            'POST /api/warehouse/service-orders/:orderId/reject'
        ]
    );
    assert.equal(harness.queryCount, 0);
});

test('module kho đăng ký đủ callback duyệt và listener ảnh xác nhận', () => {
    const harness = createRegistrationHarness();

    assert.equal(harness.actions.length, 3);
    assert.match(harness.actions[0].pattern, /wh_approve/);
    assert.match(harness.actions[1].pattern, /wh_appgrp/);
    assert.match(harness.actions[2].pattern, /wh_svc_approve/);
    assert.deepEqual(harness.events.map(event => event.eventNames), [
        ['photo', 'document']
    ]);
});

test('public API của module bị đóng băng và giới hạn upload giữ nguyên', () => {
    const harness = createRegistrationHarness();

    assert.equal(Object.isFrozen(harness.moduleApi), true);
    assert.equal(typeof harness.moduleApi.syncWarehouseSheets, 'function');
    assert.equal(typeof harness.moduleApi.updateWarehouseSheetProof, 'function');
    assert.deepEqual(WAREHOUSE_IMAGE_LIMITS, {
        maxBytesPerImage: 15 * 1024 * 1024,
        maxImageCount: 6
    });
});

test('timekeep bot chỉ lắp ghép module, không còn khai báo route kho trực tiếp', () => {
    const source = fs.readFileSync(
        new URL('../../../timekeep_bot.js', import.meta.url),
        'utf8'
    );

    assert.match(source, /registerWarehouseModule\(\{/);
    assert.doesNotMatch(source, /botApp\.(get|post)\(['"]\/api\/warehouse/);
    assert.doesNotMatch(source, /bot\.action\(\/\^\(wh_/);
    assert.doesNotMatch(source, /FROM tk_warehouse_transactions/);
});

test('luồng xuất kho cũ cũng dùng quyền Web Admin và khóa transaction', () => {
    const exportRoute = fs.readFileSync(new URL('./http/export-routes.js', import.meta.url), 'utf8');
    const groupAction = fs.readFileSync(
        new URL('./telegram/register-group-order-actions.js', import.meta.url),
        'utf8'
    );
    const singleAction = fs.readFileSync(
        new URL('./telegram/register-single-order-actions.js', import.meta.url),
        'utf8'
    );
    const proofHandler = fs.readFileSync(
        new URL('./telegram/register-proof-handler.js', import.meta.url),
        'utf8'
    );

    for (const source of [exportRoute, groupAction, singleAction]) {
        assert.match(source, /tk_warehouse_permissions/);
        assert.doesNotMatch(source, /role\s+IN\s*\(/i);
    }
    assert.match(exportRoute, /FOR UPDATE/);
    assert.match(groupAction, /FOR UPDATE OF t/);
    assert.match(singleAction, /FOR UPDATE OF t/);
    assert.match(groupAction, /BEGIN/);
    assert.match(singleAction, /BEGIN/);
    assert.match(proofHandler, /bot_role = 'warehouse'/);
    assert.match(proofHandler, /t\.group_id = \$2/);
});
