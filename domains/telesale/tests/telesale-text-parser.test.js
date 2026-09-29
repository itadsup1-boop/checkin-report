import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseTelesaleNumber,
    isTelesaleReportMessage,
    parseTelesaleTextMessage
} from '../domain/telesale-text-parser.js';

test('Telesale Text Parser - parseTelesaleNumber', async (t) => {
    await t.test('bóc tách số lượng thông thường', () => {
        assert.equal(parseTelesaleNumber('10'), 10);
        assert.equal(parseTelesaleNumber(' 5 '), 5);
        assert.equal(parseTelesaleNumber('0'), 0);
        assert.equal(parseTelesaleNumber(''), 0);
        assert.equal(parseTelesaleNumber('-'), 0);
        assert.equal(parseTelesaleNumber('không'), 0);
        assert.equal(parseTelesaleNumber('3 khách'), 3);
    });

    await t.test('bóc tách số tiền doanh số linh hoạt', () => {
        assert.equal(parseTelesaleNumber('15.000.000', true), 15000000);
        assert.equal(parseTelesaleNumber('15,000,000', true), 15000000);
        assert.equal(parseTelesaleNumber('15000000', true), 15000000);
        assert.equal(parseTelesaleNumber('15tr', true), 15000000);
        assert.equal(parseTelesaleNumber('15 triệu', true), 15000000);
        assert.equal(parseTelesaleNumber('2.5tr', true), 2500000);
        assert.equal(parseTelesaleNumber('500k', true), 500000);
        assert.equal(parseTelesaleNumber('0đ', true), 0);
        assert.equal(parseTelesaleNumber('0', true), 0);
        assert.equal(parseTelesaleNumber('', true), 0);
    });
});

test('Telesale Text Parser - isTelesaleReportMessage', async (t) => {
    await t.test('nhận diện đúng tin nhắn báo cáo theo mẫu', () => {
        const text = `
Nhân sự: Nguyễn Hồng Việt
Số nhận: 10
Số trùng / KNC/ Văng: 2
Số lịch PV mới: 3
Số lịch PV cũ: 1
Lịch hẹn ngày mai: 4
Tổng tới hôm nay: 2
Tổng bong hôm nay: 0
TỔNG DS hnay: 15.000.000
        `.trim();
        assert.equal(isTelesaleReportMessage(text), true);
    });

    await t.test('nhận diện khi có tiêu đề báo cáo', () => {
        assert.equal(isTelesaleReportMessage('📊 BÁO CÁO TELE HÀNG NGÀY'), true);
        assert.equal(isTelesaleReportMessage('Báo cáo telesale hôm nay'), true);
    });

    await t.test('bỏ qua tin nhắn trò chuyện thông thường', () => {
        assert.equal(isTelesaleReportMessage('Chào mọi người, hôm nay ai trực ca chiều thế?'), false);
        assert.equal(isTelesaleReportMessage('Alo sếp ơi check giúp em đơn này'), false);
        assert.equal(isTelesaleReportMessage('Ok em nhé'), false);
    });
});

test('Telesale Text Parser - parseTelesaleTextMessage', async (t) => {
    await t.test('parse đầy đủ 9 trường mẫu chuẩn', () => {
        const text = `
Nhân sự: Nguyễn Hồng Việt
Số nhận: 15
Số trùng / KNC/ Văng: 2
Số lịch PV mới: 4
Số lịch PV cũ: 1
Lịch hẹn ngày mai: 3
Tổng tới hôm nay: 2
Tổng bong hôm nay: 1
TỔNG DS hnay: 25.000.000
        `.trim();

        const result = parseTelesaleTextMessage(text);
        assert.equal(result.isValid, true);
        assert.equal(result.employee_name, 'Nguyễn Hồng Việt');
        assert.equal(result.so_nhan, 15);
        assert.equal(result.so_trung_knc_vang, 2);
        assert.equal(result.lich_pv_moi, 4);
        assert.equal(result.lich_pv_cu, 1);
        assert.equal(result.lich_ngay_mai, 3);
        assert.equal(result.tong_toi_hnay, 2);
        assert.equal(result.tong_bong_hnay, 1);
        assert.equal(result.tong_ds_hnay, 25000000);
    });

    await t.test('tự động điền 0 cho các trường để trống', () => {
        const text = `
Nhân sự: Nguyễn Hồng Việt
Số nhận: 10
Số trùng / KNC/ Văng: 
Số lịch PV mới: 2
Số lịch PV cũ: 
Lịch hẹn ngày mai: 1
Tổng tới hôm nay: 
Tổng bong hôm nay: 
TỔNG DS hnay: 
        `.trim();

        const result = parseTelesaleTextMessage(text);
        assert.equal(result.isValid, true);
        assert.equal(result.employee_name, 'Nguyễn Hồng Việt');
        assert.equal(result.so_nhan, 10);
        assert.equal(result.so_trung_knc_vang, 0);
        assert.equal(result.lich_pv_moi, 2);
        assert.equal(result.lich_pv_cu, 0);
        assert.equal(result.lich_ngay_mai, 1);
        assert.equal(result.tong_toi_hnay, 0);
        assert.equal(result.tong_bong_hnay, 0);
        assert.equal(result.tong_ds_hnay, 0);
    });

    await t.test('hỗ trợ viết tắt, khoảng trắng không đều và tiền tệ dạng 18tr', () => {
        const text = `
Nhân sự :   Lê Thuỳ Trang
Số nhận : 8
Trùng / KNC / Văng: 1
Lịch PV mới: 2
Lịch PV cũ: 0
Lịch ngày mai: 2
Tới hôm nay: 1
Bong hôm nay: 0
Tổng DS hnay: 18tr
        `.trim();

        const result = parseTelesaleTextMessage(text);
        assert.equal(result.isValid, true);
        assert.equal(result.employee_name, 'Lê Thuỳ Trang');
        assert.equal(result.so_nhan, 8);
        assert.equal(result.so_trung_knc_vang, 1);
        assert.equal(result.lich_pv_moi, 2);
        assert.equal(result.lich_pv_cu, 0);
        assert.equal(result.lich_ngay_mai, 2);
        assert.equal(result.tong_toi_hnay, 1);
        assert.equal(result.tong_bong_hnay, 0);
        assert.equal(result.tong_ds_hnay, 18000000);
    });
});
