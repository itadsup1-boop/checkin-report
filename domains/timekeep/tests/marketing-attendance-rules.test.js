import test from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateMarketingCheckin,
    isMarketingCheckoutEligible,
    isCheckoutTrigger,
    formatMarketingCheckinReply,
    formatMarketingCheckoutReply,
    formatMissedCheckoutNotification,
    MARKETING_PENALTIES,
    isMarketingPolicy
} from '../domain/marketing-attendance-rules.js';

test('isMarketingPolicy nhận diện đúng policy MARKETING', () => {
    assert.equal(isMarketingPolicy('MARKETING'), true);
    assert.equal(isMarketingPolicy('marketing'), true);
    assert.equal(isMarketingPolicy('CLINIC'), false);
    assert.equal(isMarketingPolicy(null), false);
});

test('evaluateMarketingCheckin: check-in trước hoặc đúng 08:30:00 là đúng giờ (công 1.0, phạt 0đ)', () => {
    const res1 = evaluateMarketingCheckin('08:15:20');
    assert.equal(res1.isLate, false);
    assert.equal(res1.penalty, 0);
    assert.equal(res1.workCredit, 1.0);
    assert.equal(res1.status, 'DUNG_GIO');

    const res2 = evaluateMarketingCheckin('08:30:00');
    assert.equal(res2.isLate, false);
    assert.equal(res2.penalty, 0);
    assert.equal(res2.workCredit, 1.0);
    assert.equal(res2.status, 'DUNG_GIO');
});

test('evaluateMarketingCheckin: check-in từ 08:30:01 đến 09:30:00 là đi muộn (phạt 50.000đ, công 1.0)', () => {
    const res1 = evaluateMarketingCheckin('08:30:01');
    assert.equal(res1.isLate, true);
    assert.equal(res1.penalty, 50000);
    assert.equal(res1.workCredit, 1.0);
    assert.equal(res1.status, 'MUON_DUOI_60P');

    const res2 = evaluateMarketingCheckin('09:15:00');
    assert.equal(res2.isLate, true);
    assert.equal(res2.penalty, 50000);
    assert.equal(res2.workCredit, 1.0);

    const res3 = evaluateMarketingCheckin('09:30:00');
    assert.equal(res3.isLate, true);
    assert.equal(res3.penalty, 50000);
    assert.equal(res3.workCredit, 1.0);
});

test('evaluateMarketingCheckin: check-in sau 09:30:00 (muộn > 60 phút) phạt 50.000đ và trừ 1/2 ngày công (công 0.5)', () => {
    const res1 = evaluateMarketingCheckin('09:30:01');
    assert.equal(res1.isLate, true);
    assert.equal(res1.penalty, 50000);
    assert.equal(res1.workCredit, 0.5);
    assert.equal(res1.status, 'MUON_TREN_60P');

    const res2 = evaluateMarketingCheckin('10:45:00');
    assert.equal(res2.isLate, true);
    assert.equal(res2.penalty, 50000);
    assert.equal(res2.workCredit, 0.5);
    assert.match(res2.reason, /Trừ 1\/2 ngày công/);
});

test('isMarketingCheckoutEligible: chỉ cho phép check-out sau 18:30:00', () => {
    assert.equal(isMarketingCheckoutEligible('17:45:00'), false);
    assert.equal(isMarketingCheckoutEligible('18:29:59'), false);
    assert.equal(isMarketingCheckoutEligible('18:30:00'), true);
    assert.equal(isMarketingCheckoutEligible('18:45:30'), true);
    assert.equal(isMarketingCheckoutEligible('20:00:00'), true);
});

test('isCheckoutTrigger: nhận diện từ khoá #checkout, /checkout, checkout', () => {
    assert.equal(isCheckoutTrigger('#checkout'), true);
    assert.equal(isCheckoutTrigger('Nguyễn Văn A #checkout'), true);
    assert.equal(isCheckoutTrigger('/checkout'), true);
    assert.equal(isCheckoutTrigger('em check out nha'), true);
    assert.equal(isCheckoutTrigger('em check in sang nay'), false);
    assert.equal(isCheckoutTrigger(''), false);
});

test('formatMarketingCheckinReply: định dạng tin nhắn đúng giờ và đi muộn', () => {
    const onTimeMsg = formatMarketingCheckinReply({
        fullName: 'Lê Thuỳ Linh',
        role: 'Marketing',
        timeStr: '08:25 - 24/09/2026',
        evaluation: { isLate: false, penalty: 0, workCredit: 1.0 }
    });
    assert.match(onTimeMsg, /CHECK-IN HỢP LỆ – MARKETING/);
    assert.match(onTimeMsg, /Lê Thuỳ Linh/);
    assert.match(onTimeMsg, /Đúng giờ/);

    const lateMsg = formatMarketingCheckinReply({
        fullName: 'Hoàng Văn Nam',
        role: 'Marketing',
        timeStr: '09:40 - 24/09/2026',
        evaluation: { isLate: true, penalty: 50000, workCredit: 0.5, reason: 'Đi muộn quá 60 phút' }
    });
    assert.match(lateMsg, /GHI NHẬN ĐI MUỘN – MARKETING/);
    assert.match(lateMsg, /50\.000đ/);
    assert.match(lateMsg, /Trừ 1\/2 ngày công/);
});

test('formatMarketingCheckoutReply: định dạng tin nhắn check-out thành công', () => {
    const msg = formatMarketingCheckoutReply({
        fullName: 'Lê Thuỳ Linh',
        role: 'Marketing',
        timeStr: '18:45 - 24/09/2026'
    });
    assert.match(msg, /CHECK-OUT THÀNH CÔNG – MARKETING/);
    assert.match(msg, /18:45 - 24\/09\/2026/);
});

test('formatMissedCheckoutNotification: tổng hợp danh sách phạt 20.000đ', () => {
    const msg = formatMissedCheckoutNotification({
        dateFormatted: '24/09/2026',
        employees: [
            { fullName: 'Nguyễn Văn A' },
            { fullName: 'Trần Thị B' }
        ]
    });
    assert.match(msg, /THÔNG BÁO QUÊN CHECK-OUT/);
    assert.match(msg, /Nguyễn Văn A — phạt 20\.000đ/);
    assert.match(msg, /40\.000đ/);
    assert.equal(MARKETING_PENALTIES.MISSED_CHECKOUT, 20000);
});

test('evaluateMarketingCheckin: check-in Chủ Nhật trước hoặc đúng 09:00:00 là đúng giờ (công 1.0, phạt 0đ)', () => {
    const res = evaluateMarketingCheckin('08:39:45', { deadline: '09:00:00', lateCutoff: '10:00:00' });
    assert.strictEqual(res.isLate, false);
    assert.strictEqual(res.penalty, 0);
    assert.strictEqual(res.workCredit, 1.0);
    assert.strictEqual(res.status, 'DUNG_GIO');
});

test('evaluateMarketingCheckin: check-in Chủ Nhật từ 09:00:01 đến 10:00:00 là đi muộn (phạt 50.000đ, công 1.0)', () => {
    const res = evaluateMarketingCheckin('09:15:00', { deadline: '09:00:00', lateCutoff: '10:00:00' });
    assert.strictEqual(res.isLate, true);
    assert.strictEqual(res.penalty, 50000);
    assert.strictEqual(res.workCredit, 1.0);
    assert.strictEqual(res.status, 'MUON_DUOI_60P');
});

test('evaluateMarketingCheckin: check-in Chủ Nhật sau 10:00:00 là muộn > 60p (phạt 50.000đ, trừ 1/2 công)', () => {
    const res = evaluateMarketingCheckin('10:05:00', { deadline: '09:00:00', lateCutoff: '10:00:00' });
    assert.strictEqual(res.isLate, true);
    assert.strictEqual(res.penalty, 50000);
    assert.strictEqual(res.workCredit, 0.5);
    assert.strictEqual(res.status, 'MUON_TREN_60P');
});
