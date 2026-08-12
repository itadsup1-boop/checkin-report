import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function readPublicFile(name) {
    return fs.readFileSync(new URL(`../../../public/${name}`, import.meta.url), 'utf8');
}

function inlineScript(html) {
    const match = html.match(/<script>([\s\S]*?)<\/script>/);
    assert.ok(match, 'Không tìm thấy inline script');
    return match[1];
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

test('các Mini App kho cũ luôn gửi chữ ký kèm chat_id khi đọc danh mục/tồn kho', () => {
    for (const name of ['warehouse_export.html', 'warehouse_inventory.html']) {
        const script = inlineScript(readPublicFile(name));
        assert.doesNotThrow(() => new Function(script));
        assert.match(script, /warehouseAuthQuery/);
        assert.match(script, /chat_id=/);
        assert.match(script, /sig=/);
    }
});
