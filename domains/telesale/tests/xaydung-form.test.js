import test from 'node:test';
import assert from 'node:assert/strict';
import { isTelesaleReportMessage, parseTelesaleTextMessage } from '../domain/telesale-text-parser.js';
import { calculateDynamicForm } from '../domain/safe-formula-engine.js';
import { buildDynamicTelesaleReportMessage } from '../domain/telesale-messages.js';

test('Telesale Xây Dựng 24h - Phân tích cú pháp và tính toán form động', async (t) => {
    const rawText = `
📊 BÁO CÁO TELE HÀNG NGÀY
Nhân sự: Hoàng Thị Mai
Số nhận: 20
Số trùng / KNC/ Văng (trên 200km): 3
Số đơn chốt mới: 2
Số đơn chốt cũ: 1
TỔNG DS hnay: 35.000.000
1. Anh Tuấn - Cải tạo biệt thự: 20.000.000
2. Chị Ngọc - Thiết kế nội thất: 15.000.000
    `.trim();

    await t.test('Nhận diện tin nhắn báo cáo Xây Dựng 24h', () => {
        assert.equal(isTelesaleReportMessage(rawText), true);
    });

    await t.test('Bóc tách các trường đặc thù và danh sách khách hàng', () => {
        const parsed = parseTelesaleTextMessage(rawText);
        assert.equal(parsed.isValid, true);
        assert.equal(parsed.employee_name, 'Hoàng Thị Mai');
        assert.equal(parsed.so_nhan, 20);
        assert.equal(parsed.so_trung_knc_vang, 3);
        assert.equal(parsed.so_don_chot_moi, 2);
        assert.equal(parsed.so_don_chot_cu, 1);
        assert.equal(parsed.tong_ds_hnay, 35000000);
        assert.equal(parsed.customers.length, 2);
        assert.equal(parsed.customers[0].name, 'Anh Tuấn - Cải tạo biệt thự');
        assert.equal(parsed.customers[0].amount, 20000000);
    });

    await t.test('Tính toán chỉ số tự động và cảnh báo < 5%', () => {
        const fields = [
            { key: 'so_nhan', label: 'Số nhận', type: 'number', category: 'INPUT', default: 0, order_index: 1 },
            { key: 'so_trung_knc_vang', label: 'Số trùng / KNC/ Văng (trên 200km)', type: 'number', category: 'INPUT', default: 0, order_index: 2 },
            { key: 'so_don_chot_moi', label: 'Số đơn chốt mới', type: 'number', category: 'INPUT', default: 0, order_index: 3 },
            { key: 'so_don_chot_cu', label: 'Số đơn chốt cũ', type: 'number', category: 'INPUT', default: 0, order_index: 4 },
            { key: 'tong_ds_hnay', label: 'TỔNG DS hnay', type: 'currency', category: 'INPUT', default: 0, order_index: 5 },
            { key: 'tong_ds_thang', label: 'Tổng DS cộng dồn tháng', type: 'currency', category: 'CALCULATED', formula: '{tong_ds_hnay}', is_monthly_cumulative: true, order_index: 6 },
            { key: 'tong_khach_chot', label: 'Tổng khách chốt cộng dồn', type: 'number', category: 'CALCULATED', formula: '{so_don_chot_moi} + {so_don_chot_cu}', order_index: 7 },
            { key: 'ty_le_chot', label: 'Tỷ lệ khách chốt cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_khach_chot} / {so_nhan}) * 100', order_index: 8, thresholds: [{ operator: '<', value: 5, badge: '⚠️ (Cảnh báo < 5%)', type: 'warning' }] }
        ];

        const parsed = parseTelesaleTextMessage(rawText);
        const dynamicResult = calculateDynamicForm(fields, { ...parsed, ...(parsed.customValues || {}) }, { tong_ds_thang: 15000000 });

        assert.equal(dynamicResult.values.tong_khach_chot, 3);
        assert.equal(dynamicResult.values.ty_le_chot, 15);
        assert.equal(dynamicResult.values.tong_ds_thang, 50000000);
        assert.ok(!dynamicResult.badges.ty_le_chot); // 15% >= 5% không bị cảnh báo

        // Trường hợp chốt 0 đơn -> 0% (< 5%) -> kích hoạt cảnh báo
        const lowResult = calculateDynamicForm(fields, { so_nhan: 20, so_don_chot_moi: 0, so_don_chot_cu: 0, tong_ds_hnay: 0 }, { tong_ds_thang: 0 });
        assert.equal(lowResult.values.ty_le_chot, 0);
        assert.equal(lowResult.badges.ty_le_chot.badge, '⚠️ (Cảnh báo < 5%)');

        const msg = buildDynamicTelesaleReportMessage({
            employeeName: 'Hoàng Thị Mai',
            dateStr: '29/09/2026',
            fields,
            dynamicResult,
            customers: parsed.customers
        });

        assert.match(msg, /Số đơn chốt mới: <b>2<\/b>/);
        assert.match(msg, /Tổng khách chốt cộng dồn: <b>3<\/b>/);
        assert.match(msg, /Tỷ lệ khách chốt cộng dồn: <b>15%<\/b>/);
        assert.match(msg, /Chi tiết khách hàng:/);
        assert.match(msg, /Anh Tuấn - Cải tạo biệt thự/);
    });
});
