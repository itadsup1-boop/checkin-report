import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('../../../apps/bot/public/', import.meta.url));

// Ba Mini App kho + hạ tầng dùng chung (core/ + icons + overlay quét mã).
const EXPORT_APP_DIR = path.join(PUBLIC_DIR, 'warehouse', 'export');
const IMPORT_APP_DIR = path.join(PUBLIC_DIR, 'warehouse', 'import');
const INVENTORY_APP_DIR = path.join(PUBLIC_DIR, 'warehouse', 'inventory');
const SHARED_UI_DIR = path.join(PUBLIC_DIR, 'shared-ui');

function readPublicFile(name) {
    return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

function inlineScript(html) {
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(match, 'Không tìm thấy inline script');
    return match[1];
}

/** Tất cả file .js trong một thư mục module, đường dẫn tương đối để lỗi dễ đọc. */
function modulesIn(directory) {
    return fs.readdirSync(directory, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js'))
        .sort();
}

function readModule(directory, relativePath) {
    return fs.readFileSync(path.join(directory, relativePath), 'utf8');
}

/**
 * Bỏ ghi chú để test soi CODE THẬT.
 * Cần thiết vì các file ở đây có nhiều ghi chú giải thích lý do lịch sử, trong đó
 * nhắc lại đúng những tên mà test đang tìm — quét cả ghi chú sẽ báo sai.
 */
function stripComments(source) {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const exportAppModules = () => modulesIn(EXPORT_APP_DIR);
const importAppModules = () => modulesIn(IMPORT_APP_DIR);
const inventoryAppModules = () => modulesIn(INVENTORY_APP_DIR);
const sharedUiModules = () => modulesIn(SHARED_UI_DIR);
const readExportModule = relativePath => readModule(EXPORT_APP_DIR, relativePath);
const readImportModule = relativePath => readModule(IMPORT_APP_DIR, relativePath);
const readInventoryModule = relativePath => readModule(INVENTORY_APP_DIR, relativePath);
const readSharedModule = relativePath => readModule(SHARED_UI_DIR, relativePath);

/** Mọi module của cả bốn thư mục, kèm nhãn thư mục để báo lỗi rõ nguồn. */
function allWarehouseModules() {
    return [
        ...exportAppModules().map(rel => ({ dir: EXPORT_APP_DIR, label: `warehouse/export/${rel}`, rel })),
        ...importAppModules().map(rel => ({ dir: IMPORT_APP_DIR, label: `warehouse/import/${rel}`, rel })),
        ...inventoryAppModules().map(rel => ({ dir: INVENTORY_APP_DIR, label: `warehouse/inventory/${rel}`, rel })),
        ...sharedUiModules().map(rel => ({ dir: SHARED_UI_DIR, label: `shared-ui/${rel}`, rel }))
    ];
}

test('luồng đơn dịch vụ giữ đủ bảo vệ của bản cũ', () => {
    // Trước đây các khẳng định này soi warehouse_order.html — một trang KHÔNG có
    // đường vào nào (không có action whorder, router không định tuyến, bot không
    // phát URL). Trang đó đã xóa; luồng đang chạy thật là flows/order/ trong Mini
    // App xuất kho, vào bằng nút Xuất Kho -> "Xuất theo khách hàng".
    const flow = readExportModule('flows/order/index.js');
    const draft = readExportModule('flows/order/order-draft.js');
    const product = readExportModule('flows/order/steps/product-step.js');

    // Chống gửi trùng đơn khi mạng chập chờn.
    assert.match(flow, /newIdempotencyKey/);
    assert.match(draft, /idempotency_key: state\.idempotencyKey/);
    assert.match(readSharedModule('core/api.js'), /globalThis\.crypto\?\.randomUUID/);

    // Chống mất dữ liệu khi Mini App bị đóng giữa chừng.
    assert.match(flow, /createDraftStore\('customer'\)/);
    assert.match(readSharedModule('core/draft.js'), /localStorage\.setItem/);

    // Quét mã vạch thêm sản phẩm ngoài mẫu.
    assert.match(flow, /openScanner/);

    // Contract với POST /api/warehouse/service-orders.
    assert.match(draft, /service_id: serviceId/);
    assert.match(draft, /is_removed/);
    assert.match(draft, /item_source: 'TEMPLATE'/);
    assert.match(draft, /item_source: 'MANUAL'/);
    assert.match(draft, /template_quantity/);

    // Ba mức cảnh báo tồn kho phải còn đủ.
    assert.match(product, /Cần lấy bù/);
    assert.match(product, /Thiếu hàng/);
    assert.match(product, /cần lấy bù từ cơ sở kia/);

    // Thiếu hàng toàn hệ thống thì CHẶN gửi, không chỉ cảnh báo.
    assert.match(flow, /if \(missingRows\(state, catalog\)\.length > 0\)/);
});

test('trang đơn dịch vụ cũ đã bị gỡ, không còn bản trùng lặp', () => {
    // Hai bản cùng làm một việc là nguồn gốc của sửa nhầm chỗ: đã có người sửa quy
    // tắc "số điện thoại ≥ 4 số" vào trang chết này trong khi bản chạy thật nằm nơi khác.
    assert.equal(
        fs.existsSync(path.join(PUBLIC_DIR, 'warehouse_order.html')), false,
        'warehouse_order.html là trang không có đường vào — không được để lại'
    );
    // Và không được có action nào trỏ tới nó.
    assert.doesNotMatch(readPublicFile('router.html'), /whorder|warehouse_order/);
});

test('warehouse_import.html chỉ là shell nạp module, không chứa logic nghiệp vụ', () => {
    const html = readPublicFile('warehouse_import.html');

    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /telegram-web-app\.js/);
    assert.match(html, /barcode-scanner\.js/, 'nhập kho cần bộ quét mã');
    assert.match(html, /warehouse\/import\/theme\.css/);
    assert.match(html, /<script type="module" src="\/mini-app\/_v__ASSET_V__\/warehouse\/import\/app\.js">/);

    const inlineBlocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.equal(inlineBlocks.length, 0, 'Shell không được chứa inline script');
    assert.ok(html.length < 3000, `Shell quá lớn (${html.length} bytes), logic phải nằm trong module`);
});

test('Mini App nhập kho chỉ nhận tối đa 6 ảnh, nén khoảng 350KB và báo đúng hai giai đoạn', () => {
    // Ngưỡng nén: ảnh gốc điện thoại 3–8MB, 6 ảnh là ~30MB -> quá 60s timeout.
    const compressor = readImportModule('media/image-compressor.js');
    assert.match(compressor, /IMAGE_TARGET_MAX_BYTES\s*=\s*350\s*\*\s*1024/);
    assert.match(compressor, /IMAGE_MAX_DIMENSION\s*=\s*1280/);
    // PNG trong suốt sang JPEG bị nền đen nếu không tô trắng trước.
    assert.match(compressor, /fillStyle = '#fff'/);
    // Ảnh dọc trên iPhone có cờ EXIF; bỏ qua là minh chứng bị xoay ngang.
    assert.match(compressor, /imageOrientation: 'from-image'/);

    assert.match(readImportModule('domain/import-draft.js'), /MAX_PROOF_IMAGES\s*=\s*6/);

    const photos = readImportModule('steps/photos-step.js');
    assert.match(photos, /accept: 'image\/\*'/);
    assert.match(photos, /multiple: true/);
    // Video bị loại và phải nói rõ, không im lặng bỏ qua.
    assert.match(photos, /file\.type\.startsWith\('image\/'\)/);
    assert.match(photos, /chỉ nhận hình ảnh/);
    assert.doesNotMatch(photos, /accept: '[^']*video/i);

    // Tiến độ chặn ở 99% khi vẫn đang tải, và đổi nhãn sang giai đoạn ghi nhận.
    const repo = readImportModule('data/import-repo.js');
    assert.match(repo, /Math\.min\(99, raw\)/);
    assert.match(repo, /SUBMIT_TIMEOUT_MS\s*=\s*60000/);
    const app = readImportModule('app.js');
    assert.match(app, /Đang tải ảnh minh chứng lên/);
    assert.match(app, /Đang ghi nhận nhập kho/);
});

test('Mini App nhập kho gửi đúng contract của POST /api/warehouse/import', () => {
    const repo = readImportModule('data/import-repo.js');

    // Server đọc từ multipart form, không phải JSON body.
    for (const fieldName of ['chat_id', 'items', 'ts', 'sig', 'action', 'branch', 'media_files']) {
        assert.match(repo, new RegExp(`formData\\.append\\('${fieldName}'`), `thiếu field ${fieldName}`);
    }
    assert.match(repo, /'x-telegram-init-data'/);
    // Phải dùng XHR: fetch không có tiến độ tải lên.
    assert.match(repo, /new XMLHttpRequest\(\)/);
    assert.match(repo, /request\.upload\.onprogress/);

    // items phải mang đúng ba khóa mà import-routes.js đọc.
    const draft = readImportModule('domain/import-draft.js');
    assert.match(draft, /barcode: item\.barcode/);
    assert.match(draft, /product_name: item\.productName/);
    assert.match(draft, /quantity: item\.quantity/);

    // action của app này là whimport, không được mượn của xuất kho.
    assert.match(readImportModule('app.js'), /configureWarehouseApi\(\{ action: 'whimport' \}\)/);
});

test('warehouse_inventory.html chỉ là shell nạp module, không chứa logic nghiệp vụ', () => {
    const html = readPublicFile('warehouse_inventory.html');

    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /telegram-web-app\.js/);
    assert.match(html, /warehouse\/inventory\/theme\.css/);
    assert.match(html, /<script type="module" src="\/mini-app\/_v__ASSET_V__\/warehouse\/inventory\/app\.js">/);

    const inlineBlocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.equal(inlineBlocks.length, 0, 'Shell không được chứa inline script');
    assert.ok(html.length < 3000, `Shell quá lớn (${html.length} bytes), logic phải nằm trong module`);
});

test('Mini App tồn kho dùng stock-overview để không hiện trùng dòng', () => {
    // /api/warehouse/inventory LEFT JOIN tk_inventory mà không lọc branch nên trả
    // một dòng cho mỗi cơ sở -> sản phẩm có hàng ở cả US và UK bị hiện hai lần.
    const repo = readInventoryModule('data/inventory-repo.js');
    assert.match(repo, /\/api\/warehouse\/stock-overview/);
    assert.doesNotMatch(repo, /\/api\/warehouse\/inventory\?/);
    // Phải tách theo cơ sở, không chỉ một con số tổng vô danh.
    assert.match(repo, /stock_us/);
    assert.match(repo, /stock_uk/);
});

test('Mini App tồn kho lấy lịch sử biến động từ sổ ledger, không tự suy diễn', () => {
    const repo = readInventoryModule('data/inventory-repo.js');
    assert.match(repo, /\/api\/warehouse\/product-history/);
    assert.match(repo, /balance_before/);
    assert.match(repo, /balance_after/);
    assert.match(repo, /actor_name/);

    // Endpoint phải tồn tại thật ở tầng interfaces, không phải URL treo.
    const routes = fs.readFileSync(
        fileURLToPath(new URL('../interfaces/miniapp-api/catalog-routes.js', import.meta.url)), 'utf8');
    assert.match(routes, /\/api\/warehouse\/product-history/);
    assert.match(routes, /tk_warehouse_ledger/);
});

test('Mini App tồn kho có nhãn tiếng Việt cho MỌI event_type mà ledger ghi ra', () => {
    // Thiếu một loại là màn hình lịch sử hiện chuỗi kỹ thuật thô như
    // "TRANSFER_IN_DIRECT_USE" cho nhân sự đọc.
    const ledgerWriters = [
        '../infrastructure/postgres/ledger-repository.js',
        '../interfaces/miniapp-api/import-routes.js'
    ];

    const writtenTypes = new Set();
    for (const relative of ledgerWriters) {
        const source = fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
        // Chỉ lấy phần INSERT vào ledger, để không quét lẫn event_type của outbox.
        for (const block of source.split('INSERT INTO tk_warehouse_ledger').slice(1)) {
            const values = block.slice(0, block.indexOf('`', 1));
            for (const match of values.matchAll(/'([A-Z][A-Z_]{3,})'/g)) writtenTypes.add(match[1]);
        }
    }

    assert.ok(writtenTypes.size >= 5, `Không tìm thấy đủ event_type, chỉ có ${[...writtenTypes]}`);

    const detail = readInventoryModule('screens/product-detail.js');
    const labelled = detail.slice(detail.indexOf('LOAI_BIEN_DONG'), detail.indexOf('function moTaLoai'));
    for (const eventType of writtenTypes) {
        assert.ok(labelled.includes(eventType), `thiếu nhãn tiếng Việt cho ${eventType}`);
    }

    // Số dư ảo (điều chuyển dùng ngay) không được hiển thị như tồn thật.
    assert.match(detail, /virtualBalance \? null : `còn/);
    assert.match(readInventoryModule('data/inventory-repo.js'), /metadata\?\.virtual_balance/);
});

test('Mini App tồn kho không hardcode sản phẩm, đơn vị tính hay ngưỡng riêng lẻ', () => {
    for (const relativePath of inventoryAppModules()) {
        const source = readInventoryModule(relativePath);

        // Dữ liệu mẫu của bản mockup không được lọt vào code thật.
        assert.doesNotMatch(source, /ALL_PRODUCTS|MOCK_|SAMPLE_/, `${relativePath} còn dữ liệu mẫu`);
        // tk_products chỉ có id/barcode/product_name -> không được bịa đơn vị tính.
        assert.doesNotMatch(source, /\bchai\b|\bmiếng\b|\btuýp\b/i, `${relativePath} bịa đơn vị tính`);
        // Cũng không được bịa ngưỡng tồn tối thiểu theo từng sản phẩm.
        assert.doesNotMatch(source, /item\.min\b|minStock/, `${relativePath} bịa ngưỡng riêng cho sản phẩm`);
    }

    // Ngưỡng "sắp hết" là quy tắc hiển thị dùng chung, khai báo đúng một chỗ.
    const repo = readInventoryModule('data/inventory-repo.js');
    assert.match(repo, /NGUONG_SAP_HET\s*=\s*\d+/);
    const declarations = inventoryAppModules()
        .filter(rel => /NGUONG_SAP_HET\s*=\s*\d/.test(readInventoryModule(rel)));
    assert.deepEqual(declarations, ['data/inventory-repo.js'],
        'ngưỡng sắp hết chỉ được khai báo trong data/inventory-repo.js');
});

test('Mini App tồn kho có đủ ba cách thu hẹp danh sách theo yêu cầu nghiệp vụ', () => {
    const components = readInventoryModule('ui/components.js');
    assert.match(components, /branchTabs/);
    assert.match(components, /searchBox/);
    assert.match(components, /alertStatCard/);

    const overview = readInventoryModule('screens/inventory-overview.js');
    // Lọc cơ sở, tìm kiếm và lọc "cần chú ý" phải kết hợp được với nhau.
    assert.match(overview, /state\.branch/);
    assert.match(overview, /state\.query/);
    assert.match(overview, /state\.onlyShortage/);
    assert.match(overview, /stockOf\(item, state\.branch\)/);

    // Gõ tìm kiếm chỉ vẽ lại danh sách; vẽ lại cả ô input sẽ mất con trỏ trên máy.
    const onInput = overview.slice(overview.indexOf('onInput:'), overview.indexOf('onClear:'));
    assert.match(onInput, /renderList\(\)/);
    assert.doesNotMatch(onInput, /\brender\(\)/);

    // Tab phải nằm trong slot được vẽ lại. Lỗi từng gặp: branchTabs dựng một lần
    // trong render() nên bấm US thì số liệu đổi mà ô đang chọn vẫn ở "Tất cả".
    assert.match(overview, /const tabsSlot = /);
    assert.match(overview, /function renderTabs\(\)/);
    assert.match(overview, /replaceChildren\(tabsSlot,\s*\n\s*branchTabs\(/);
    const refreshBody = overview.slice(overview.indexOf('function refresh()'), overview.indexOf('function renderTabs()'));
    assert.match(refreshBody, /renderTabs\(\)/, 'refresh() phải vẽ lại tab');
    assert.match(refreshBody, /renderStats\(\)/);
    assert.match(refreshBody, /renderList\(\)/);
});

test('Mini App tồn kho giữ hướng phụ thuộc screens -> ui/data', () => {
    for (const relativePath of inventoryAppModules()) {
        const source = readInventoryModule(relativePath);
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);
        const resolved = imports.map(specifier =>
            path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)));

        if (relativePath.startsWith('data/')) {
            for (const target of resolved) {
                assert.ok(
                    !target.startsWith('screens/') && !target.startsWith('ui/'),
                    `data/ không được phụ thuộc screens/ui: ${relativePath} -> ${target}`
                );
            }
        }

        if (relativePath.startsWith('ui/')) {
            for (const target of resolved) {
                assert.ok(
                    !target.startsWith('screens/'),
                    `ui/ không được phụ thuộc screens: ${relativePath} -> ${target}`
                );
            }
        }
    }
});

test('warehouse_export.html chỉ là shell nạp module, không chứa logic nghiệp vụ', () => {
    const html = readPublicFile('warehouse_export.html');

    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /telegram-web-app\.js/);
    assert.match(html, /barcode-scanner\.js/);
    assert.match(html, /warehouse\/export\/theme\.css/);
    assert.match(html, /<script type="module" src="\/mini-app\/_v__ASSET_V__\/warehouse\/export\/app\.js">/);

    // Không còn inline script chứa nghiệp vụ: mọi <script> đều phải có src.
    const inlineBlocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.equal(inlineBlocks.length, 0, 'Shell không được chứa inline script');

    // Shell phải mỏng; nếu phình ra là dấu hiệu logic bị nhồi trở lại HTML.
    assert.ok(html.length < 3000, `Shell quá lớn (${html.length} bytes), logic phải nằm trong module`);
});

test('ba Mini App kho dùng CHUNG một bộ token màu, không app nào tự khai màu riêng', () => {
    // Trước đây mỗi app tự khai khối :root nên cùng chức năng quản lý kho lại ba
    // màu nhấn khác nhau (nhập emerald / xuất rose / tồn cyan). Màu chủ đạo giờ lấy
    // theo màn hình tồn kho: cyan #0891b2.
    const tokensFile = path.join(SHARED_UI_DIR, 'theme-tokens.css');
    assert.ok(fs.existsSync(tokensFile), 'thiếu shared-ui/theme-tokens.css');
    const tokens = fs.readFileSync(tokensFile, 'utf8');
    assert.match(tokens, /--brand:\s*#0891b2/, 'màu chủ đạo phải là cyan của màn hình tồn kho');

    const appThemes = ['warehouse/export', 'warehouse/import', 'warehouse/inventory'];

    for (const app of appThemes) {
        const theme = fs.readFileSync(path.join(PUBLIC_DIR, app, 'theme.css'), 'utf8');

        // Không được khai lại token: khai lại là mở đường cho lệch màu.
        assert.doesNotMatch(theme, /^:root\s*\{/m, `${app}/theme.css không được có khối :root riêng`);

        // Và không được viết mã màu trực tiếp. Chỉ #fff/#000 được phép (chữ trên nền
        // đậm, nền khung camera) vì đó không phải màu nhận diện.
        const hexes = [...theme.matchAll(/#[0-9a-fA-F]{3,8}\b/g)]
            .map(match => match[0].toLowerCase())
            .filter(hex => !['#fff', '#ffffff', '#000', '#000000'].includes(hex));
        assert.deepEqual(hexes, [], `${app}/theme.css còn mã màu cứng: ${hexes.join(', ')}`);
    }

    // Cũng không được rải mã màu trong JS — chỗ này từng giữ rose/emerald/cyan
    // riêng cho từng app và là chỗ đầu tiên bị lệch.
    for (const { dir, label, rel } of allWarehouseModules()) {
        if (dir === SHARED_UI_DIR && rel === 'ui/icons.js') continue;
        const hexes = [...readModule(dir, rel).matchAll(/'#[0-9a-fA-F]{3,8}'|#[0-9a-fA-F]{6}\b/g)]
            .map(match => match[0].replace(/'/g, '').toLowerCase())
            .filter(hex => hex !== '#fff' && hex !== '#ffffff');
        assert.deepEqual(hexes, [], `${label} phải dùng token/class thay vì mã màu: ${hexes.join(', ')}`);
    }

    // Cả ba shell phải nạp token TRƯỚC theme của app, nếu không token bị ghi đè sai thứ tự.
    for (const [shell, app] of [
        ['warehouse_export.html', 'warehouse/export'],
        ['warehouse_import.html', 'warehouse/import'],
        ['warehouse_inventory.html', 'warehouse/inventory']
    ]) {
        const html = readPublicFile(shell);
        const tokenIndex = html.indexOf('shared-ui/theme-tokens.css');
        const themeIndex = html.indexOf(`${app}/theme.css`);
        assert.ok(tokenIndex > 0, `${shell} chưa nạp theme-tokens.css`);
        assert.ok(tokenIndex < themeIndex, `${shell} phải nạp token trước theme của app`);
    }

    // Mọi var(--x) đều phải có token thật, vì token không còn nằm trong theme của app.
    const declared = new Set([...tokens.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map(match => match[1]));
    for (const app of appThemes) {
        const theme = fs.readFileSync(path.join(PUBLIC_DIR, app, 'theme.css'), 'utf8');
        for (const match of theme.matchAll(/var\((--[a-z0-9-]+)/g)) {
            assert.ok(declared.has(match[1]), `${app}/theme.css dùng ${match[1]} nhưng token không tồn tại`);
        }
    }
});

test('mọi module Mini App kho có cú pháp hợp lệ', () => {
    const modules = allWarehouseModules();
    assert.ok(modules.length >= 25, `Cần đủ module đã tách, hiện có ${modules.length}`);
    assert.ok(exportAppModules().length >= 6, 'Mini App xuất kho phải được chia thành nhiều module');
    assert.ok(importAppModules().length >= 10, 'Mini App nhập kho phải được chia thành nhiều module');
    assert.ok(inventoryAppModules().length >= 5, 'Mini App tồn kho phải được chia thành nhiều module');

    for (const { dir, label, rel } of modules) {
        assert.doesNotThrow(
            () => execFileSync(process.execPath, ['--check', path.join(dir, rel)], { stdio: 'pipe' }),
            `Sai cú pháp: ${label}`
        );
    }
});

test('ba Mini App kho dùng chung hạ tầng shared-ui, không nhân đôi core', () => {
    // Trước đây core/ và icons.js nằm trong Mini App xuất kho; thêm app mới mà copy
    // sang là hàng trăm dòng trùng lặp, sửa một bên quên bên kia.
    const shared = sharedUiModules();
    for (const expected of [
        'core/api.js', 'core/dom.js', 'core/telegram.js', 'core/branches.js',
        'ui/icons.js', 'ui/scanner.js'
    ]) {
        assert.ok(shared.includes(expected), `shared-ui thiếu ${expected}`);
    }

    // Không app nào được tự dựng lại các file này trong thư mục riêng.
    const duplicable = ['core/', 'ui/icons.js', 'ui/scanner.js'];
    for (const relativePath of [...exportAppModules(), ...importAppModules(), ...inventoryAppModules()]) {
        assert.ok(
            !duplicable.some(name => relativePath === name || relativePath.startsWith(name)),
            `${relativePath} nhân đôi hạ tầng đã có ở shared-ui`
        );
    }

    // Và phải thực sự import từ đó.
    for (const read of [readExportModule, readImportModule, readInventoryModule]) {
        assert.match(read('app.js'), /shared-ui\/core\//);
    }

    // Danh sách cơ sở chỉ được khai báo MỘT chỗ: code phải khớp tk_inventory.branch.
    assert.match(readSharedModule('core/branches.js'), /code: 'US'/);
    assert.match(readSharedModule('core/branches.js'), /code: 'UK'/);
    const redeclared = allWarehouseModules().filter(({ dir, rel }) =>
        !(dir === SHARED_UI_DIR && rel === 'core/branches.js')
        && /BRANCHES\s*=\s*\[/.test(readModule(dir, rel)));
    assert.deepEqual(redeclared.map(entry => entry.label), [],
        'danh sách cơ sở chỉ được khai báo trong shared-ui/core/branches.js');

    // Cả hai app cần quét mã đều dùng chung overlay, không tự lấy global BarcodeScanner.
    // Chỉ xét code thật: các file có ghi chú nhắc tới BarcodeScanner để giải thích vì
    // sao không tự đếm số lần quét, không được tính là vi phạm.
    for (const { dir, label, rel } of allWarehouseModules()) {
        if (dir === SHARED_UI_DIR && rel === 'ui/scanner.js') continue;
        assert.doesNotMatch(stripComments(readModule(dir, rel)), /BarcodeScanner/,
            `${label} phải dùng openScanner() thay vì tự lấy global BarcodeScanner`);
    }
});

test('Mini App xuất kho giữ hướng phụ thuộc flows -> ui/data -> core', () => {
    for (const relativePath of exportAppModules()) {
        const source = readExportModule(relativePath);
        const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);
        const resolved = imports.map(specifier =>
            path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), specifier)));

        if (relativePath.startsWith('core/')) {
            for (const target of resolved) {
                assert.ok(
                    !target.startsWith('flows/') && !target.startsWith('ui/') && !target.startsWith('data/'),
                    `core/ không được phụ thuộc tầng trên: ${relativePath} -> ${target}`
                );
            }
        }

        if (relativePath.startsWith('data/')) {
            for (const target of resolved) {
                assert.ok(
                    !target.startsWith('flows/') && !target.startsWith('ui/'),
                    `data/ không được phụ thuộc flows/ui: ${relativePath} -> ${target}`
                );
            }
        }
    }
});

test('Mini App kho luôn xác thực qua core/api và không gọi fetch trực tiếp', () => {
    const api = readSharedModule('core/api.js');
    assert.match(api, /warehouseAuthQuery/);
    assert.match(api, /chat_id/);
    assert.match(api, /\bts\b/);
    assert.match(api, /\bsig\b/);
    assert.match(api, /\baction\b/);
    assert.match(api, /initData/);
    assert.match(api, /'X-Telegram-Init-Data'/);
    assert.match(api, /globalThis\.crypto\?\.randomUUID/);

    // Chỉ core/api.js được phép gọi fetch; nơi khác phải đi qua apiGet/apiPost.
    for (const { dir, label, rel } of allWarehouseModules()) {
        if (dir === SHARED_UI_DIR && rel === 'core/api.js') continue;
        assert.doesNotMatch(
            readModule(dir, rel),
            /\bfetch\s*\(/,
            `${label} phải dùng apiGet/apiPost thay vì fetch trực tiếp`
        );
    }
});

test('Mini App xuất kho không hardcode dịch vụ, sản phẩm hay đơn vị tính', () => {
    const repo = readExportModule('data/warehouse-repo.js');
    assert.match(repo, /\/api\/warehouse\/stock-overview/);
    assert.match(repo, /\/api\/warehouse\/service-order\/bootstrap/);

    for (const relativePath of exportAppModules()) {
        const source = readExportModule(relativePath);

        // Các mảng dữ liệu mẫu của bản mockup không được lọt vào code thật.
        assert.doesNotMatch(source, /PRODUCTS_BY_SERVICE|ALL_PRODUCTS/, `${relativePath} còn dữ liệu mẫu`);
        assert.doesNotMatch(source, /const\s+SERVICES\s*=\s*\[/, `${relativePath} còn danh sách dịch vụ hardcode`);

        // tk_products không có cột đơn vị tính nên UI không được bịa ra "chai/hộp".
        assert.doesNotMatch(source, /\bchai\b|\bmiếng\b|\btuýp\b/i, `${relativePath} bịa đơn vị tính`);
    }
});

test('Mini App xuất kho giữ đúng contract của hai API xuất kho', () => {
    const quick = readExportModule('flows/quick-export.js');
    assert.match(quick, /\/api\/warehouse\/export\/request/);
    assert.match(quick, /barcode:/);
    assert.match(quick, /quantity:/);
    assert.match(quick, /branch/);
    assert.match(quick, /quantity_mode === 'DECIMAL'/);
    assert.match(quick, /allowDecimal/);

    // Luồng đơn khách hàng đã tách thành thư mục riêng vì file cũ dài 610 dòng.
    // Gộp lại để soi contract như một khối, tránh sót khi thêm bước mới.
    const customer = ['flows/order/index.js', 'flows/order/order-draft.js']
        .concat(modulesIn(path.join(EXPORT_APP_DIR, 'flows', 'order', 'steps'))
            .map(name => `flows/order/steps/${name}`))
        .map(readExportModule)
        .join('\n');

    assert.match(customer, /\/api\/warehouse\/service-orders/);
    assert.match(customer, /service_id/);
    assert.match(customer, /doctor_name/);
    assert.match(customer, /technician_name/);
    assert.match(customer, /is_removed/);
    assert.match(customer, /item_source/);
    assert.match(customer, /template_quantity/);
    assert.match(customer, /idempotency_key/);
    assert.match(customer, /phoneDigitCount\(state\.customerPhone\) >= 4/);
    assert.match(customer, /Nhập ít nhất 4 số/);
    assert.doesNotMatch(customer, /customerPhone\.trim\(\)\.length >= (?:8|10)/);
    assert.match(customer, /quantity_mode/);

    const components = readExportModule('ui/components.js');
    assert.match(components, /inputMode: allowDecimal \? 'decimal' : 'numeric'/);
    assert.match(components, /type: 'number'/);

    // Chống mất dữ liệu khi Mini App bị đóng giữa lúc nhập.
    const draft = readSharedModule('core/draft.js');
    assert.match(draft, /localStorage\.setItem/);
    assert.match(draft, /localStorage\.removeItem/);
});

test('Mini App xuất kho chỉ nhận tối đa một chữ số sau dấu thập phân', () => {
    const components = readExportModule('ui/components.js');
    const quick = readExportModule('flows/quick-export.js');
    const orderDraft = readExportModule('flows/order/order-draft.js');
    const productStep = readExportModule('flows/order/steps/product-step.js');

    assert.match(components, /toFixed\(1\)/);
    assert.match(components, /next \* 10/);
    assert.doesNotMatch(components, /toFixed\(3\)/);
    assert.doesNotMatch(`${quick}\n${orderDraft}\n${productStep}`, /0\.001|toFixed\(3\)/);
});

test('asset Mini App kho có cơ chế đổi URL theo phiên bản', () => {
    // Cloudflare ghi đè Cache-Control thành max-age=14400 nên client giữ file .js cũ.
    // Chỉ đổi URL mới ép tải lại được; token do bot chèn theo mtime của thư mục module.
    for (const [shell, appDir] of [
        ['warehouse_export.html', 'warehouse/export'],
        ['warehouse_inventory.html', 'warehouse/inventory']
    ]) {
        const html = readPublicFile(shell);
        assert.match(html, new RegExp(`_v__ASSET_V__/${appDir}/app\\.js`));
        assert.match(html, new RegExp(`_v__ASSET_V__/${appDir}/theme\\.css`));
    }

    const bot = fs.readFileSync(fileURLToPath(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url)), 'utf8');
    assert.match(bot, /__ASSET_V__/, 'bot phải thay token phiên bản vào shell');
    assert.match(bot, /getWarehouseAssetVersion/);
    assert.match(bot, /no-store/, 'shell kho phải trả no-store');

    // Token phải tính trên CẢ hạ tầng dùng chung: sửa shared-ui/core mà token
    // không đổi thì client vẫn dùng code cũ.
    for (const directory of ['warehouse', 'shared-ui']) {
        assert.ok(
            bot.includes(`'${directory}'`),
            `token phiên bản phải tính cả thư mục ${directory}`
        );
    }
    assert.match(bot, /warehouse_inventory\.html': path\.join/, 'shell tồn kho phải được đăng ký');
    // Middleware bỏ tiền tố phải đứng trước express.static của /mini-app.
    const stripIndex = bot.indexOf("req.url.match(/^\\/mini-app\\/_v");
    const staticIndex = bot.indexOf("botApp.use('/mini-app', express.static");
    assert.ok(stripIndex > 0, 'thiếu middleware bỏ tiền tố _v');
    assert.ok(stripIndex < staticIndex, 'middleware _v phải đứng trước express.static');
});

test('Mini App kho đọc được chữ ký từ cả ba đường vào', () => {
    const telegram = readSharedModule('core/telegram.js');

    // Nút trong nhóm là deep link ?startapp=... nên Telegram đưa vào start_param.
    assert.match(telegram, /initDataUnsafe\?\.start_param/);
    // router.html chuyển hướng sang trang đích kèm ?payload=<action>_<gid>_<ts>_<sig>.
    assert.match(telegram, /params\.get\('payload'\)/);
    assert.match(telegram, /tgWebAppStartParam/);
    // Lệnh /start whexport_ mở trực tiếp bằng tham số rời.
    assert.match(telegram, /params\.get\('chat_id'\)/);
    // Dạng gộp phải tách đúng thứ tự [action, chatId, ts, sig].
    assert.match(telegram, /split\('_'\)/);
    assert.match(telegram, /parts\.length >= 4/);

    // router.html vẫn phải định tuyến cả hai chức năng về đúng trang.
    const router = readPublicFile('router.html');
    assert.match(router, /startsWith\('whexport'\)/);
    assert.match(router, /warehouse_export\.html/);
    assert.match(router, /warehouse_inventory\.html/);
    assert.match(router, /\?payload=\$\{startParam\}/);
});

test('Mini App kho không dựng HTML từ dữ liệu người dùng', () => {
    // Chỉ hai file hạ tầng được dùng innerHTML, và chỉ với hằng số trong chính file đó
    // (icons.js là path SVG cố định, dom.js là helper đặt nội dung tĩnh).
    for (const { dir, label, rel } of allWarehouseModules()) {
        if (dir === SHARED_UI_DIR && (rel === 'ui/icons.js' || rel === 'core/dom.js')) continue;
        assert.doesNotMatch(
            readModule(dir, rel),
            /innerHTML/,
            `${label} phải dùng h() thay vì innerHTML`
        );
    }
});

test('Mini App nhập kho không cho ghi đè mã vạch của sản phẩm khác', () => {
    // Đường "Nhập tay" từng cho gõ tự do mã vạch: US gõ mã 002 vốn là
    // "Cannula 23g" của UK -> tên cũ bị ghi đè, tồn kho hai mặt hàng gộp làm một.
    const draft = readImportModule('domain/import-draft.js');
    assert.match(draft, /export function checkBarcodeOwnership/);
    // Phải xét cả danh mục hệ thống VÀ các dòng đã có trong phiếu đang nhập.
    assert.match(draft, /scope: 'catalog'/);
    assert.match(draft, /scope: 'draft'/);
    // So tên phải bỏ qua hoa/thường và khoảng trắng thừa, giống cách server so.
    assert.match(draft, /replace\(\/\\s\+\/g, ' '\)\.toLowerCase\(\)/);

    const sheet = readImportModule('steps/manual-add-sheet.js');
    // Chốt chặn phải chạy TRƯỚC khi gọi onAdd, kể cả khi nhân sự sửa mã rồi bấm ngay.
    const submitBody = sheet.slice(sheet.indexOf('function submit()'), sheet.indexOf('/* ---------- Render'));
    const guardIndex = submitBody.indexOf('checkBarcodeOwnership(');
    const addIndex = submitBody.indexOf('onAdd(');
    assert.ok(guardIndex > 0, 'submit() phải kiểm tra chủ sở hữu mã vạch');
    assert.ok(guardIndex < addIndex, 'phải chặn trước khi thêm vào phiếu');

    // Chọn sản phẩm có sẵn thì KHÔNG được hiện ô tạo mã mới.
    assert.match(sheet, /isCreatingNew\(\)/);
    assert.match(sheet, /&& !state\.picked && !exactMatch\(\)/);
});

test('Mini App nhập kho: tra cứu mã thất bại KHÔNG được coi là sản phẩm mới', () => {
    // Đây là nhánh đã gây mất tên "Cannula 23g": lỗi mạng cũng mở ô nhập tên nên
    // nhân sự đặt tên mới cho một mã đã tồn tại.
    const sheet = readImportModule('steps/scan-sheet.js');
    assert.match(sheet, /renderLookupFailed/);
    assert.match(sheet, /Không kiểm tra được mã vạch/);
    // Nhánh lỗi chỉ được hiện nút quét lại / đóng, tuyệt đối không có ô nhập tên.
    const failBody = sheet.slice(sheet.indexOf('function renderLookupFailed'), sheet.indexOf('function onQuantity'));
    assert.doesNotMatch(failBody, /Tên sản phẩm mới/, 'nhánh lỗi không được mở ô nhập tên');
    assert.doesNotMatch(failBody, /quantityInput/, 'nhánh lỗi không được cho nhập số lượng');
    assert.match(failBody, /Quét lại/);

    // Việc quyết định "mới hay cũ" phải do máy chủ trả lời, và lỗi thì ném ra.
    const repo = readImportModule('data/import-repo.js');
    assert.match(repo, /\/api\/products\/by-barcode\//);
    assert.doesNotMatch(repo, /catch[\s\S]{0,80}exists: true/, 'không được tự suy diễn khi lỗi');
});

test('Mini App nhập kho tự đề xuất mã cho sản phẩm mới nhưng vẫn cho sửa', () => {
    const repo = readImportModule('data/import-repo.js');
    assert.match(repo, /\/api\/warehouse\/next-barcode/);

    const sheet = readImportModule('steps/manual-add-sheet.js');
    assert.match(sheet, /fillSuggestedCode/);
    // Mã đề xuất được điền sẵn nhưng ô vẫn nhận onInput -> sửa được.
    assert.match(sheet, /onInput: event => onCodeInput\(event\.target\.value\)/);
    assert.match(sheet, /sửa được nhưng phải là mã chưa tồn tại/);
    // Không ghi đè nếu nhân sự đã kịp tự gõ mã trong lúc chờ máy chủ trả lời.
    assert.match(sheet, /if \(!force && state\.customCode\) return/);
    // Sửa mã là kiểm tra lại ngay, không đợi tới lúc bấm Thêm.
    assert.match(sheet, /function onCodeInput[\s\S]{0,160}validateCode\(value\)/);
});

test('Mini App nhập kho giữ đúng 4 bước và không cho bỏ qua điều kiện', () => {
    const app = readImportModule('app.js');
    for (const key of ['branch', 'products', 'photos', 'confirm']) {
        assert.match(app, new RegExp(`key: '${key}'`), `thiếu bước ${key}`);
    }

    // Trước khi gửi phải kiểm lại MỌI bước: nhân sự có thể lùi lại xóa hết ảnh
    // rồi tiến tới bấm gửi.
    const submitBody = app.slice(app.indexOf('async function submit()'), app.indexOf('/* ---------- Render'));
    assert.match(submitBody, /for \(const step of STEPS\)/);
    assert.match(submitBody, /checkStep\(step\.key, state\)/);
    assert.match(submitBody, /if \(state\.submitting\) return/, 'phải chặn bấm gửi hai lần');

    const draft = readImportModule('domain/import-draft.js');
    assert.match(draft, /stepKey === 'branch' && !branch/);
    assert.match(draft, /stepKey === 'products' && items\.length === 0/);
    assert.match(draft, /stepKey === 'photos' && photos\.length === 0/);

    // Số lượng phải là số nguyên dương — server từ chối mọi giá trị khác.
    assert.match(draft, /Number\.isInteger\(quantity\) && quantity > 0/);
});
