import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCurrency, parseReport, detectReportTrigger, computeReportDeadline } from '../domain/report-parsing.js';
import { getEffectiveKpiTarget } from '../domain/kpi-target.js';
import { findMissingReporters } from '../domain/missing-reporters.js';

test('parseCurrency đọc đúng đơn vị triệu/nghìn tiếng Việt', () => {
    assert.equal(parseCurrency('12tr'), 12000000);
    assert.equal(parseCurrency('500k'), 500000);
    assert.equal(parseCurrency('2 triệu'), 2000000);
    assert.equal(parseCurrency('1.500.000'), 1500000);
    assert.equal(parseCurrency(''), 0);
    assert.equal(parseCurrency(null), 0);
});

test('parseReport chấp nhận mẫu cũ một dòng "#baocao 15"', () => {
    const result = parseReport('#baocao 15');
    assert.equal(result.is_valid, true);
    assert.equal(result.kpi_actual, 15);
    assert.equal(result.total_photos_needed, 15);
});

test('parseReport yêu cầu đủ 3 mục: tin nhắn, doanh thu, lịch khách', () => {
    const missing = parseReport('#baocao\nSố tin nhắn: 10\nDoanh thu: 0');
    assert.equal(missing.is_valid, false);
    assert.match(missing.error_msg, /Lịch khách/);

    const full = parseReport('#baocao\nSố tin nhắn: 10\nDoanh thu: 500k\nLịch khách: 2/10');
    assert.equal(full.is_valid, true);
    assert.equal(full.kpi_actual, 10);
    assert.equal(full.doanh_thu, 500000);
    assert.equal(full.total_photos_needed, 11); // +1 vì có doanh thu
});

test('parseReport chặn lịch khách sai định dạng (thiếu / hoặc "tái khám")', () => {
    const bad = parseReport('#baocao\nSố tin nhắn: 10\nDoanh thu: 0\nLịch khách: có khách A');
    assert.equal(bad.is_valid, false);
    assert.match(bad.error_msg, /dấu gạch chéo/);

    const ok = parseReport('#baocao\nSố tin nhắn: 10\nDoanh thu: 0\nLịch khách: khách tái khám');
    assert.equal(ok.is_valid, true);
});

test('parseReport không nhận báo cáo thiếu tiền tố trigger', () => {
    assert.equal(parseReport('xin chào', '#baocao').is_valid, false);
});

test('detectReportTrigger bắt đúng lệnh trigger của nhóm', () => {
    const result = detectReportTrigger('#baocao\nSố tin nhắn: 10', '#baocao');
    assert.equal(result.matched, true);
    assert.equal(result.usedTrigger, '#baocao');
});

test('detectReportTrigger nhận diện báo cáo gõ tự nhiên không đúng lệnh', () => {
    const natural = detectReportTrigger('báo cáo hôm nay\ntin nhắn: 10\ndoanh thu: 200k', '#baocao');
    assert.equal(natural.matched, true);
    assert.equal(natural.usedTrigger, '', 'bắt tự nhiên thì bỏ qua kiểm tra tiền tố trong parseReport');
});

test('detectReportTrigger bỏ qua tin nhắn không liên quan báo cáo', () => {
    const result = detectReportTrigger('chào buổi sáng cả nhà', '#baocao');
    assert.equal(result.matched, false);
});

test('computeReportDeadline = giờ nhắc + 2 tiếng, tối thiểu 5 phút kể từ lúc nộp', () => {
    const now = new Date('2026-08-14T09:00:00');
    const deadline = computeReportDeadline('17:00:00', now);
    assert.equal(deadline.getHours(), 19);
    assert.equal(deadline.getMinutes(), 0);

    // Nộp sát/trễ giờ vẫn được tối thiểu 5 phút để tải ảnh.
    const lateNow = new Date('2026-08-14T19:30:00');
    const lateDeadline = computeReportDeadline('17:00:00', lateNow);
    assert.ok(lateDeadline.getTime() >= lateNow.getTime() + 5 * 60 * 1000);
});

test('getEffectiveKpiTarget: miễn báo cáo trả 0, không có chỉ tiêu riêng thì dùng mặc định', () => {
    assert.equal(getEffectiveKpiTarget({ need_report: false, current_kpi_target: 40 }), 0);
    assert.equal(getEffectiveKpiTarget({ current_kpi_target: null }), 40);
    assert.equal(getEffectiveKpiTarget({ current_kpi_target: 25 }), 25);
    assert.equal(getEffectiveKpiTarget(null), 0);
});

test('findMissingReporters loại bỏ người đã nộp/nghỉ theo lịch/xin nghỉ phép', () => {
    const employees = [
        { full_name: 'A', telegram_id: '1' },
        { full_name: 'B', telegram_id: '2' },
        { full_name: 'C', telegram_id: '3' },
        { full_name: 'D', telegram_id: '4' }
    ];
    const missing = findMissingReporters(employees, {
        reportedIds: ['1'],
        offDutyIds: ['2'],
        onLeaveIds: ['3']
    });
    assert.deepEqual(missing.map(e => e.full_name), ['D']);
});
