import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeTelesalePayload,
    calculateTelesaleStats,
    formatVnd,
    TELESALE_THRESHOLDS
} from '../domain/telesale-rules.js';
import {
    buildTelesaleReportMessage,
    buildTelesaleReminderMessage,
    buildTelesalePenaltyNotice,
    buildTelesaleDailyTeamSummary
} from '../domain/telesale-messages.js';

describe('Telesale Rules & Calculations', () => {
    test('normalizeTelesalePayload chuẩn hoá dữ liệu thô, all là số, mặc định = 0', () => {
        const raw = {
            so_nhan: '25',
            so_trung_knc_vang: ' 5 ',
            tong_ds_hnay: '10.000.000'
        };

        const norm = normalizeTelesalePayload(raw);
        assert.equal(norm.so_nhan, 25);
        assert.equal(norm.so_trung_knc_vang, 5);
        assert.equal(norm.lich_pv_moi, 0); // Mặc định 0
        assert.equal(norm.lich_pv_cu, 0);
        assert.equal(norm.lich_ngay_mai, 0);
        assert.equal(norm.tong_toi_hnay, 0);
        assert.equal(norm.tong_bong_hnay, 0);
        assert.equal(norm.tong_ds_hnay, 10000000);
    });

    test('calculateTelesaleStats tính đúng 6 mục BOT tự cộng và ngưỡng cảnh báo / khen thưởng', () => {
        const data = {
            so_nhan: 20,
            so_trung_knc_vang: 4,
            lich_pv_moi: 5,
            lich_pv_cu: 2,
            lich_ngay_mai: 4,
            tong_toi_hnay: 4,
            tong_bong_hnay: 1,
            tong_ds_hnay: 10000000
        };
        const monthlyPrevRevenue = 40000000;

        const stats = calculateTelesaleStats(data, monthlyPrevRevenue);

        // 1. Tổng lịch trong ngày = 5 + 2 = 7
        assert.equal(stats.tong_lich, 7);

        // 2. Tổng DS cộng dồn tháng = 40tr + 10tr = 50tr
        assert.equal(stats.tong_ds_thang, 50000000);

        // 3. Tổng khách tới trong ngày = 4
        assert.equal(stats.tong_toi, 4);

        // 4. Doanh số TB / khách tới = 10tr / 4 = 2.500.000 đ/khách
        assert.equal(stats.ty_le_khach_toi_ds, 2500000);

        // 5. Tỷ lệ lịch = (7 / 20) * 100% = 35% (> 25% -> không cảnh báo)
        assert.equal(stats.ty_le_lich, 35.0);
        assert.equal(stats.isLichWarning, false);

        // 6. Tỉ lệ tới = (4 / 20) * 100% = 20% (> 19% -> khen thưởng)
        assert.equal(stats.ty_le_toi, 20.0);
        assert.equal(stats.isToiReward, true);
        assert.equal(stats.isToiWarning, false);
    });

    test('calculateTelesaleStats bật cảnh báo khi Tỷ lệ lịch < 25% hoặc Tỉ lệ tới < 15%', () => {
        const data = {
            so_nhan: 20,
            lich_pv_moi: 3,
            lich_pv_cu: 1, // Tổng lịch = 4 -> 4/20 = 20% < 25%
            tong_toi_hnay: 2, // Khách tới = 2 -> 2/20 = 10% < 15%
            tong_ds_hnay: 2000000
        };

        const stats = calculateTelesaleStats(data, 0);

        assert.equal(stats.tong_lich, 4);
        assert.equal(stats.ty_le_lich, 20.0);
        assert.equal(stats.isLichWarning, true, 'Phải cảnh báo tỷ lệ lịch < 25%');

        assert.equal(stats.tong_toi, 2);
        assert.equal(stats.ty_le_toi, 10.0);
        assert.equal(stats.isToiWarning, true, 'Phải cảnh báo tỉ lệ tới < 15%');
        assert.equal(stats.isToiReward, false);
    });

    test('formatVnd định dạng chuẩn tiền tệ Việt Nam', () => {
        assert.equal(formatVnd(10000000), '10.000.000 đ');
        assert.equal(formatVnd(0), '0 đ');
    });

    test('buildTelesaleReportMessage hiển thị đầy đủ các trường yêu cầu', () => {
        const stats = calculateTelesaleStats({
            so_nhan: 20,
            so_trung_knc_vang: 2,
            lich_pv_moi: 4,
            lich_pv_cu: 2,
            lich_ngay_mai: 3,
            tong_toi_hnay: 4,
            tong_bong_hnay: 1,
            tong_ds_hnay: 8000000
        }, 30000000);

        const msg = buildTelesaleReportMessage({
            employeeName: 'Nguyễn Văn A',
            dateStr: '22/09/2026',
            stats,
            sheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit'
        });

        assert.match(msg, /BÁO CÁO TELE HÀNG NGÀY/);
        assert.match(msg, /Nguyễn Văn A/);
        assert.match(msg, /Số nhận: 20/);
        assert.match(msg, /10\. BOT tự cộng:/);
        assert.match(msg, /Tổng lịch cộng dồn: <b>6 lịch<\/b>/);
        assert.match(msg, /Tổng DS cộng dồn tháng: <b>38\.000\.000 đ<\/b>/);
        assert.match(msg, /Tỷ lệ lịch cộng dồn: <b>30%<\/b>/);
        assert.match(msg, /Tỉ lệ tới cộng dồn: <b>20%<\/b> 🌟/);
        assert.doesNotMatch(msg, /Google Sheet/);
    });

    test('buildTelesaleReportMessage format chuẩn HTML khi có cảnh báo < 25% và < 15%', () => {
        const stats = calculateTelesaleStats({
            so_nhan: 20,
            lich_pv_moi: 2,
            tong_toi_hnay: 1,
            tong_ds_hnay: 0
        }, 0);

        const msg = buildTelesaleReportMessage({
            employeeName: 'Nguyễn & Hồng <Việt>',
            dateStr: '23/09/2026',
            stats
        });

        // Phải escape đúng &lt; thay vì raw < để Telegram không lỗi 400
        assert.match(msg, /⚠️ \(Cảnh báo &lt; 25%\)/);
        assert.match(msg, /⚠️ \(Cảnh báo &lt; 15%\)/);
        assert.match(msg, /Nguyễn &amp; Hồng &lt;Việt&gt;/);
        assert.doesNotMatch(msg, /< 25%/);
        assert.doesNotMatch(msg, /< 15%/);
    });

    test('buildTelesaleReminderMessage chứa đúng mốc giờ 18:00 và 19:00', () => {
        const msg = buildTelesaleReminderMessage({ groupName: 'Team Telesale HN' });
        assert.match(msg, /18:00/);
        assert.match(msg, /19:00/);
        assert.match(msg, /50\.000đ/);
    });

    test('buildTelesalePenaltyNotice định dạng thông báo phạt đúng 50.000đ', () => {
        const msg = buildTelesalePenaltyNotice({
            employeeName: 'Trần Thị B',
            telegramId: '123456',
            dateStr: '22/09/2026',
            penaltyAmount: 50000
        });
        assert.match(msg, /QUÁ HẠN BÁO CÁO TELESALE/);
        assert.match(msg, /Trần Thị B/);
        assert.match(msg, /50\.000 đ/);
    });

    test('buildTelesaleReportMessage hiển thị chi tiết theo dịch vụ khi có services', () => {
        const raw = {
            so_nhan: 10,
            tong_toi_hnay: 2,
            tong_ds_hnay: 30000000,
            services: [
                { service_name: 'Căng da', lich: '2', toi: '1', ds: '20,000,000' },
                { service_name: 'Căng chỉ', lich: 1, toi: 1, ds: '10.000.000' }
            ]
        };
        const stats = calculateTelesaleStats(raw, 0);
        assert.equal(stats.services.length, 2);
        assert.equal(stats.services[0].ds, 20000000);
        assert.equal(stats.services[1].ds, 10000000);

        const msg = buildTelesaleReportMessage({
            employeeName: 'Nguyễn Văn A',
            dateStr: '22/09/2026',
            stats
        });

        assert.match(msg, /Chi tiết theo dịch vụ:/);
        assert.match(msg, /• <b>Căng da<\/b>: 2 lịch \| 1 tới \| 20\.000\.000 đ/);
        assert.match(msg, /• <b>Căng chỉ<\/b>: 1 lịch \| 1 tới \| 10\.000\.000 đ/);
    });

    test('buildTelesaleDailyTeamSummary hiển thị Tổng khách văng/knc và các số liệu tổng hợp', () => {
        const msg = buildTelesaleDailyTeamSummary({
            dateStr: '26/09/2026',
            teamTotals: {
                so_nhan: 16,
                tong_vang: 3,
                tong_lich: 1,
                tong_toi: 1,
                tong_bong: 0,
                lich_ngay_mai: 1,
                tong_ds: 1900000
            },
            memberSummaries: [
                { name: 'Quỳnh', so_nhan: 5, tong_lich: 1, tong_toi: 1, lich_ngay_mai: 0, tong_ds_hnay: 1900000 }
            ]
        });

        assert.match(msg, /TỔNG KẾT TELESALE TOÀN ĐỘI NGÀY 26\/09\/2026/);
        assert.match(msg, /Tổng số nhận: <b>16<\/b>/);
        assert.match(msg, /Tổng khách văng\/knc: <b>3<\/b>/);
        assert.match(msg, /Tổng lịch chốt: <b>1<\/b>/);
        assert.match(msg, /Tổng khách tới: <b>1<\/b>/);
        assert.match(msg, /Tổng khách bong: <b>0<\/b>/);
        assert.match(msg, /Tổng lịch hẹn ngày mai: <b>1<\/b>/);
        assert.match(msg, /TỔNG DOANH SỐ: 1\.900\.000 đ/);
        assert.match(msg, /• <b>Quỳnh<\/b>: 5 số \| 1 lịch \| 1 tới \| 0 lịch mai \| 1\.900\.000 đ/);
    });
});
