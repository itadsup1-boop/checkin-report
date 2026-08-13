import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = fileURLToPath(new URL('../../../apps/bot/public/', import.meta.url));
const EXPORT_APP_DIR = path.join(PUBLIC_DIR, 'warehouse-export');

function readPublicFile(name) {
    return fs.readFileSync(path.join(PUBLIC_DIR, name), 'utf8');
}

function inlineScript(html) {
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(match, 'Không tìm thấy inline script');
    return match[1];
}

/** Tất cả file .js của Mini App xuất kho, đường dẫn tương đối để thông báo lỗi dễ đọc. */
function exportAppModules() {
    return fs.readdirSync(EXPORT_APP_DIR, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js'))
        .sort();
}

function readExportModule(relativePath) {
    return fs.readFileSync(path.join(EXPORT_APP_DIR, relativePath), 'utf8');
}

test('Mini App đơn dịch vụ có đủ bảo vệ và cú pháp JavaScript hợp lệ', () => {
    const html = readPublicFile('warehouse_order.html');
    const script = inlineScript(html);
    assert.doesNotThrow(() => new Function(script));
    assert.match(html, /viewport-fit=cover/);
    assert.match(script, /localStorage\.setItem/);
    assert.match(script, /idempotency_key/);
    assert.match(script, /globalThis\.crypto\?\.randomUUID/);
    assert.match(script, /BarcodeScanner\.start/);
    assert.match(script, /service_id/);
    assert.match(script, /is_removed/);
    assert.match(script, /Cần lấy/);
    assert.match(script, /Tổng hai kho thiếu/);
    assert.match(script, /warehouse_export\.html/);
});

test('Mini App nhập kho chỉ nhận tối đa 6 ảnh, nén khoảng 350KB và hiển thị hai giai đoạn', () => {
    const html = readPublicFile('warehouse_import.html');
    const script = inlineScript(html);
    assert.doesNotThrow(() => new Function(script));
    assert.match(html, /multiple accept="image\/\*"/);
    assert.match(script, /IMAGE_TARGET_MAX_BYTES\s*=\s*350\s*\*\s*1024/);
    assert.match(script, /MAX_PROOF_IMAGES\s*=\s*6/);
    assert.match(script, /Math\.min\(99, rawPercent\)/);
    assert.match(script, /Đang tải minh chứng lên/);
    assert.match(script, /Đang ghi nhận nhập kho/);
    assert.match(script, /chat_id=.*payloadTs.*payloadSig/s);
    assert.doesNotMatch(html, /accept="[^"]*video/i);
});

test('Mini App tồn kho vẫn gửi chữ ký kèm chat_id khi đọc danh mục', () => {
    const script = inlineScript(readPublicFile('warehouse_inventory.html'));
    assert.doesNotThrow(() => new Function(script));
    assert.match(script, /warehouseAuthQuery/);
    assert.match(script, /chat_id=/);
    assert.match(script, /sig=/);
});

test('Mini App tồn kho đọc được chữ ký từ cả ba đường vào', () => {
    // Mở từ nút trong nhóm đi qua router.html nên chữ ký nằm trong ?payload=
    // hoặc initDataUnsafe.start_param. Trước đây chỉ đọc ?chat_id= nên API trả 400.
    const script = inlineScript(readPublicFile('warehouse_inventory.html'));
    assert.match(script, /initDataUnsafe && tg\.initDataUnsafe\.start_param/);
    assert.match(script, /warehouseParams\.get\('payload'\)/);
    assert.match(script, /tgWebAppStartParam/);
    assert.match(script, /warehouseParams\.get\('chat_id'\)/);
    assert.match(script, /parts\.length >= 4/);
    // Phải giải mã sau tg.ready() mới đọc được start_param.
    // Dùng 'resolveWarehouseAuth();' (có dấu chấm phẩy) để bắt đúng chỗ GỌI,
    // vì 'resolveWarehouseAuth()' cũng khớp với dòng định nghĩa hàm ở phía trên.
    assert.ok(
        script.indexOf('resolveWarehouseAuth();') > script.indexOf('tg.ready()'),
        'resolveWarehouseAuth phải gọi sau tg.ready()'
    );
});

test('Mini App tồn kho dùng stock-overview để không hiện trùng dòng', () => {
    // /api/warehouse/inventory LEFT JOIN tk_inventory mà không lọc branch nên trả
    // một dòng cho mỗi cơ sở -> sản phẩm có hàng ở cả US và UK bị hiện hai lần.
    const script = inlineScript(readPublicFile('warehouse_inventory.html'));
    assert.match(script, /\/api\/warehouse\/stock-overview/);
    assert.doesNotMatch(script, /fetch\(`\/api\/warehouse\/inventory\?/);
    // Phải hiển thị tách theo cơ sở, không chỉ một con số tổng vô danh.
    assert.match(script, /stock_us/);
    assert.match(script, /stock_uk/);
});

test('warehouse_export.html chỉ là shell nạp module, không chứa logic nghiệp vụ', () => {
    const html = readPublicFile('warehouse_export.html');

    assert.match(html, /viewport-fit=cover/);
    assert.match(html, /telegram-web-app\.js/);
    assert.match(html, /barcode-scanner\.js/);
    assert.match(html, /warehouse-export\/theme\.css/);
    assert.match(html, /<script type="module" src="\/mini-app\/_v__ASSET_V__\/warehouse-export\/app\.js">/);

    // Không còn inline script chứa nghiệp vụ: mọi <script> đều phải có src.
    const inlineBlocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/g) || [];
    assert.equal(inlineBlocks.length, 0, 'Shell không được chứa inline script');

    // Shell phải mỏng; nếu phình ra là dấu hiệu logic bị nhồi trở lại HTML.
    assert.ok(html.length < 3000, `Shell quá lớn (${html.length} bytes), logic phải nằm trong module`);
});

test('mọi module Mini App xuất kho có cú pháp hợp lệ', () => {
    const modules = exportAppModules();
    assert.ok(modules.length >= 10, `Cần đủ module đã tách, hiện có ${modules.length}`);

    for (const relativePath of modules) {
        assert.doesNotThrow(
            () => execFileSync(process.execPath, ['--check', path.join(EXPORT_APP_DIR, relativePath)], { stdio: 'pipe' }),
            `Sai cú pháp: ${relativePath}`
        );
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

test('Mini App xuất kho luôn xác thực qua core/api và không gọi fetch trực tiếp', () => {
    const api = readExportModule('core/api.js');
    assert.match(api, /warehouseAuthQuery/);
    assert.match(api, /chat_id/);
    assert.match(api, /\bts\b/);
    assert.match(api, /\bsig\b/);
    assert.match(api, /\baction\b/);
    assert.match(api, /initData/);
    assert.match(api, /'X-Telegram-Init-Data'/);
    assert.match(api, /globalThis\.crypto\?\.randomUUID/);

    // Chỉ core/api.js được phép gọi fetch; nơi khác phải đi qua apiGet/apiPost.
    for (const relativePath of exportAppModules()) {
        if (relativePath === 'core/api.js') continue;
        assert.doesNotMatch(
            readExportModule(relativePath),
            /\bfetch\s*\(/,
            `${relativePath} phải dùng apiGet/apiPost thay vì fetch trực tiếp`
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

    const customer = readExportModule('flows/customer-order.js');
    assert.match(customer, /\/api\/warehouse\/service-orders/);
    assert.match(customer, /service_id/);
    assert.match(customer, /is_removed/);
    assert.match(customer, /item_source/);
    assert.match(customer, /template_quantity/);
    assert.match(customer, /idempotency_key/);

    // Chống mất dữ liệu khi Mini App bị đóng giữa lúc nhập.
    const draft = readExportModule('core/draft.js');
    assert.match(draft, /localStorage\.setItem/);
    assert.match(draft, /localStorage\.removeItem/);
});

test('asset Mini App xuất kho có cơ chế đổi URL theo phiên bản', () => {
    // Cloudflare ghi đè Cache-Control thành max-age=14400 nên client giữ file .js cũ.
    // Chỉ đổi URL mới ép tải lại được; token do bot chèn theo mtime của thư mục module.
    const html = readPublicFile('warehouse_export.html');
    assert.match(html, /_v__ASSET_V__\/warehouse-export\/app\.js/);
    assert.match(html, /_v__ASSET_V__\/warehouse-export\/theme\.css/);

    const bot = fs.readFileSync(fileURLToPath(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url)), 'utf8');
    assert.match(bot, /__ASSET_V__/, 'bot phải thay token phiên bản vào shell');
    assert.match(bot, /getWarehouseAssetVersion/);
    assert.match(bot, /no-store/, 'shell xuất kho phải trả no-store');
    // Middleware bỏ tiền tố phải đứng trước express.static của /mini-app.
    const stripIndex = bot.indexOf("req.url.match(/^\\/mini-app\\/_v");
    const staticIndex = bot.indexOf("botApp.use('/mini-app', express.static");
    assert.ok(stripIndex > 0, 'thiếu middleware bỏ tiền tố _v');
    assert.ok(stripIndex < staticIndex, 'middleware _v phải đứng trước express.static');
});

test('Mini App xuất kho đọc được chữ ký từ cả ba đường vào', () => {
    const telegram = readExportModule('core/telegram.js');

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

    // router.html vẫn phải định tuyến whexport về đúng trang này.
    const router = readPublicFile('router.html');
    assert.match(router, /startsWith\('whexport'\)/);
    assert.match(router, /warehouse_export\.html/);
    assert.match(router, /\?payload=\$\{startParam\}/);
});

test('Mini App xuất kho không dựng HTML từ dữ liệu người dùng', () => {
    for (const relativePath of exportAppModules()) {
        if (relativePath === 'ui/icons.js' || relativePath === 'core/dom.js') continue;
        assert.doesNotMatch(
            readExportModule(relativePath),
            /innerHTML/,
            `${relativePath} phải dùng h() thay vì innerHTML`
        );
    }
});

test('Mini App nhập kho không cho ghi đè mã vạch của sản phẩm khác', () => {
    const script = inlineScript(readPublicFile('warehouse_import.html'));

    // Đường "Nhập tay" từng cho gõ tự do mã vạch: US gõ mã 002 vốn là
    // "Cannula 23g" của UK -> tên cũ bị ghi đè, tồn kho hai mặt hàng gộp làm một.
    assert.match(script, /barcodeOwnerMap/);
    assert.match(script, /normalizeProductName/);
    assert.match(script, /đã là sản phẩm/);

    // Chốt chặn phải nằm TRƯỚC khi thêm dòng vào đơn nhập.
    // Chỉ xét trong thân hàm submitManualAdd, vì addOrUpdateImportItem(...) còn
    // được gọi ở luồng quét mã phía trên nên indexOf trên cả file sẽ bắt nhầm.
    const start = script.indexOf('function submitManualAdd()');
    assert.ok(start > 0, 'không tìm thấy submitManualAdd');
    const body = script.slice(start, script.indexOf('\n        }', start));
    const guardIndex = body.indexOf('barcodeOwnerMap[barcode]');
    const addIndex = body.indexOf('addOrUpdateImportItem(');
    assert.ok(guardIndex > 0, 'submitManualAdd phải kiểm tra chủ sở hữu mã vạch');
    assert.ok(guardIndex < addIndex, 'phải chặn trước khi thêm vào đơn');

    // Tra cứu thất bại KHÔNG được mặc định coi là sản phẩm mới.
    assert.doesNotMatch(script, /\/\/ Xem như sản phẩm mới nếu lỗi mạng/);
    assert.match(script, /Không kiểm tra được mã vạch/);
    assert.match(script, /if \(!res\.success\)/);
});

test('Mini App nhập kho tự đề xuất mã cho sản phẩm mới nhưng vẫn cho sửa', () => {
    const script = inlineScript(readPublicFile('warehouse_import.html'));

    assert.match(script, /suggestNewBarcode/);
    assert.match(script, /\/api\/warehouse\/next-barcode/);

    // Sản phẩm đã có: khoá cả mã lẫn tên.
    assert.match(script, /barcodeInput\.disabled = true/);
    // Sản phẩm mới: mã được điền sẵn nhưng PHẢI sửa được.
    assert.match(script, /barcodeInput\.disabled = false/);
    assert.match(script, /Mã đề xuất, sửa được/);

    // Không ghi đè nếu nhân sự đã kịp tự gõ mã trong lúc chờ máy chủ trả lời.
    assert.match(script, /if \(!barcodeInput\.value\) barcodeInput\.value = suggested/);
});
