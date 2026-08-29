import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerWarehouseModule } from '../index.js';
import { WAREHOUSE_IMAGE_LIMITS } from '../interfaces/miniapp-api/warehouse-image-upload.js';
import { buildPendingMessage, buildApprovedMessage } from '../infrastructure/outbox/outbox-worker.js';

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

test('thông báo đơn xuất khách chờ duyệt hiển thị ngày và giờ tạo đơn theo giờ Việt Nam', () => {
    const momentStub = value => ({
        utcOffset(offset) {
            assert.equal(value, '2026-08-17T10:49:00.000Z');
            assert.equal(offset, 7);
            return this;
        },
        format(pattern) {
            return pattern === 'DD/MM/YYYY' ? '17/08/2026' : '17:49';
        }
    });
    const message = buildPendingMessage({
        order_code: 'ORD-TEST',
        creator_name: 'Nhân viên',
        customer_name: 'Khách hàng',
        customer_phone: '7491',
        doctor_name: 'Bác sĩ An',
        technician_name: 'Kỹ thuật viên Bình',
        branch: 'UK',
        created_at: '2026-08-17T10:49:00.000Z',
        services: []
    }, String, [], momentStub);

    assert.match(message, /Ngày tạo đơn:<\/b> 17\/08\/2026/);
    assert.match(message, /Giờ tạo đơn:<\/b> 17:49/);
    assert.match(message, /Bác sĩ:<\/b> Bác sĩ An/);
    assert.match(message, /Kỹ thuật viên:<\/b> Kỹ thuật viên Bình/);
});

test('thông báo xuất kho thành công hiển thị danh sách dịch vụ và sản phẩm đã xuất', () => {
    const message = buildApprovedMessage({
        order_code: 'ORD-20260819-4B04BC5F',
        creator_name: 'Nhung',
        customer_name: 'C hạnh',
        customer_phone: '23564',
        doctor_name: 'Trung',
        technician_name: 'Nhung',
        branch: 'UK',
        services: [
            {
                service_name_snapshot: 'Dịch vụ Triệt lông / Tiêm',
                items: [
                    { product_name: 'Botulax 100u', actual_quantity: 1, is_removed: false },
                    { product_name: 'Kim tiêm 30G', actual_quantity: 2, is_removed: false },
                    { product_name: 'Sản phẩm đã bỏ', actual_quantity: 1, is_removed: true }
                ]
            }
        ],
        transfers: [
            {
                from_branch: 'US',
                to_branch: 'UK',
                items: [{ product_name: 'Botulax 100u', quantity: 1 }]
            }
        ]
    }, String);

    assert.match(message, /\[XUẤT KHO CHO KHÁCH THÀNH CÔNG\]/);
    assert.match(message, /Mã đơn:<\/b> <code>ORD-20260819-4B04BC5F<\/code>/);
    assert.match(message, /Khách:<\/b> C hạnh/);
    assert.match(message, /Bác sĩ:<\/b> Trung/);
    assert.match(message, /Kỹ thuật viên:<\/b> Nhung/);
    assert.match(message, /Cơ sở sử dụng:<\/b> UK/);
    assert.match(message, /Người order\/bàn giao:<\/b> Nhung/);
    assert.match(message, /• Dịch vụ Triệt lông \/ Tiêm/);
    assert.match(message, /- Botulax 100u: 1/);
    assert.match(message, /- Kim tiêm 30G: 2/);
    assert.doesNotMatch(message, /Sản phẩm đã bỏ/);
    assert.match(message, /MANG HÀNG QUA CƠ SỞ SỬ DỤNG/);
    assert.match(message, /Từ US → UK/);
});

test('module kho đăng ký đủ endpoint cũ và không truy cập database lúc khởi động', () => {
    const harness = createRegistrationHarness();

    assert.deepEqual(
        harness.routes.map(route => `${route.method} ${route.path}`),
        [
            'GET /api/products/by-barcode/:barcode',
            'GET /api/warehouse/products',
            'GET /api/warehouse/inventory',
            // Mini App tồn kho đọc lịch sử biến động của một sản phẩm từ ledger.
            'GET /api/warehouse/product-history',
            'GET /api/warehouse/next-barcode',
            'GET /api/warehouse/stock-overview',
            'GET /api/warehouse/check-stock',
            'POST /api/warehouse/import',
            'POST /api/warehouse/export/request',
            'GET /api/warehouse/config',
            'GET /api/warehouse/service-order/bootstrap',
            'GET /api/warehouse/customers/suggestion',
            'POST /api/warehouse/service-orders',
            'GET /api/warehouse/service-orders/:orderId',
            'POST /api/warehouse/service-orders/:orderId/approve',
            'POST /api/warehouse/service-orders/:orderId/reject',
            'POST /api/warehouse/stock-transfers',
            'GET /api/warehouse/pricing/access',
            'GET /api/warehouse/pricing/search',
            'GET /api/warehouse/pricing/products',
            'GET /api/warehouse/pricing/history',
            'GET /api/warehouse/pricing/orders',
            'POST /api/warehouse/pricing/save',
            'POST /api/warehouse/pricing/save-batch'
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
        new URL('../../../apps/bot/timekeep_bot.js', import.meta.url),
        'utf8'
    );

    assert.match(source, /registerWarehouseModule\(\{/);
    assert.doesNotMatch(source, /botApp\.(get|post)\(['"]\/api\/warehouse/);
    assert.doesNotMatch(source, /bot\.action\(\/\^\(wh_/);
    assert.doesNotMatch(source, /FROM tk_warehouse_transactions/);
});

test('luồng xuất kho cũ cũng dùng quyền Web Admin và khóa transaction', () => {
    const exportRoute = fs.readFileSync(new URL('../interfaces/miniapp-api/export-routes.js', import.meta.url), 'utf8');
    const groupAction = fs.readFileSync(
        new URL('../interfaces/telegram/register-group-order-actions.js', import.meta.url),
        'utf8'
    );
    const singleAction = fs.readFileSync(
        new URL('../interfaces/telegram/register-single-order-actions.js', import.meta.url),
        'utf8'
    );
    const proofHandler = fs.readFileSync(
        new URL('../interfaces/telegram/register-proof-handler.js', import.meta.url),
        'utf8'
    );

    for (const source of [groupAction, singleAction]) {
        assert.match(source, /tk_warehouse_permissions/);
        assert.doesNotMatch(source, /role\s+IN\s*\(/i);
    }
    assert.match(exportRoute, /warehouseOrderService\.authorizeActor/);
    assert.match(exportRoute, /actor\.permissions/);
    assert.doesNotMatch(exportRoute, /role\s+IN\s*\(/i);
    assert.match(exportRoute, /FOR UPDATE/);
    assert.match(groupAction, /FOR UPDATE OF t/);
    assert.match(singleAction, /FOR UPDATE OF t/);
    assert.match(groupAction, /BEGIN/);
    assert.match(singleAction, /BEGIN/);
    assert.match(proofHandler, /bot_role = 'warehouse'/);
    assert.match(proofHandler, /t\.group_id = \$2/);
});

test('mọi Mini App kho dùng chung bộ xác thực theo Telegram ID và nhóm', () => {
    const importRoute = fs.readFileSync(
        new URL('../interfaces/miniapp-api/import-routes.js', import.meta.url),
        'utf8'
    );
    const exportRoute = fs.readFileSync(
        new URL('../interfaces/miniapp-api/export-routes.js', import.meta.url),
        'utf8'
    );
    const catalogRoute = fs.readFileSync(
        new URL('../interfaces/miniapp-api/catalog-routes.js', import.meta.url),
        'utf8'
    );
    const repository = fs.readFileSync(
        new URL('../infrastructure/postgres/warehouse-query-repository.js', import.meta.url),
        'utf8'
    );

    for (const source of [importRoute, exportRoute, catalogRoute]) {
        assert.match(source, /warehouseOrderService\.authorizeActor/);
    }
    assert.match(repository, /employee_group_memberships/);
    assert.match(repository, /tk_warehouse_permissions/);
    assert.match(repository, /WHEN telegram_group_id = \$2 THEN 0/);
});

test('nhập kho chặn trùng mã vạch thay vì âm thầm đổi tên sản phẩm', () => {
    const source = fs.readFileSync(
        new URL('../interfaces/miniapp-api/import-routes.js', import.meta.url),
        'utf8'
    );

    // Sự cố thật: UK nhập "Cannula 23g" mã 002, sau đó US nhập "Kim canula27g"
    // cũng mã 002 -> upsert ghi đè product_name, tên cũ biến mất và tồn kho của
    // hai mặt hàng bị gộp làm một. Ba sản phẩm đã bị mất tên vì lỗi này.
    assert.doesNotMatch(
        source,
        /ON CONFLICT \(barcode\) DO UPDATE SET\s*\n\s*product_name/,
        'không được ghi đè product_name khi trùng mã vạch'
    );

    // Phải phát hiện và từ chối trước khi ghi bất cứ thứ gì.
    assert.match(source, /barcodeConflicts/);
    assert.match(source, /SELECT barcode, product_name FROM tk_products WHERE barcode = ANY/);
    assert.match(source, /status: 409/);
    assert.match(source, /Mã vạch đã thuộc về sản phẩm khác/);

    // So tên phải bỏ qua hoa/thường và khoảng trắng thừa để không báo nhầm.
    assert.match(source, /normalizeName/);
    assert.match(source, /toLowerCase\(\)/);

    // Chốt chặn phải nằm TRƯỚC vòng lặp ghi sản phẩm.
    const guardIndex = source.indexOf('barcodeConflicts.length');
    const upsertIndex = source.indexOf('INSERT INTO tk_products');
    assert.ok(guardIndex > 0 && guardIndex < upsertIndex, 'chốt chặn phải chạy trước khi ghi');
});

test('nhập kho chống trùng mã ngay ở tầng database khi hai cơ sở lưu cùng lúc', () => {
    const source = fs.readFileSync(
        new URL('../interfaces/miniapp-api/import-routes.js', import.meta.url),
        'utf8'
    );

    // Kiểm tra đọc trước chỉ thấy dữ liệu tại một thời điểm. Nếu US và UK cùng
    // nhận mã đề xuất rồi cùng lưu, người lưu sau vẫn lọt qua vòng kiểm tra đó.
    // Mệnh đề WHERE trên ON CONFLICT là chốt chặn cuối, chạy nguyên tử trong DB.
    assert.match(source, /ON CONFLICT \(barcode\) DO UPDATE SET[\s\S]*?WHERE lower\(regexp_replace/);

    // Dùng lớp ký tự POSIX thay vì \s để không bị nuốt dấu backslash qua các lớp
    // escape — đã từng khiến biểu thức biến thành 's+' và so tên sai.
    assert.match(source, /\[\[:space:\]\]\+/);
    assert.doesNotMatch(source, /regexp_replace\([^)]*'\\s\+'/);

    // Không có dòng trả về nghĩa là mã đã thuộc sản phẩm khác -> phải báo lỗi,
    // tuyệt đối không được đi tiếp và cộng tồn vào nhầm sản phẩm.
    assert.match(source, /if \(!product\)/);
    assert.match(source, /vừa được người khác dùng cho một sản phẩm khác/);
});

test('có API đề xuất mã vạch mới và mã đề xuất không đụng mã đã dùng', () => {
    const source = fs.readFileSync(
        new URL('../interfaces/miniapp-api/catalog-routes.js', import.meta.url),
        'utf8'
    );

    assert.match(source, /\/api\/warehouse\/next-barcode/);
    // Phải coi '1', '01', '001' là cùng một mã vì Google Sheet hay cắt số 0 đầu.
    assert.match(source, /padStart\(3, '0'\)/);
    assert.match(source, /String\(Number\(barcode\)\)/);
    // Phải dò tới khi tìm được mã trống, không chỉ lấy max + 1.
    assert.match(source, /while \(used\.has/);
});
