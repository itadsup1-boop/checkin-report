import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDateKey, validateScheduleDates } from '../schedule-date-policy.js';

test('chuẩn hóa ngày lịch chỉ chấp nhận YYYY-MM-DD có thật', () => {
    assert.equal(normalizeDateKey('2026-08-18'), '2026-08-18');
    assert.equal(normalizeDateKey('2026-02-30'), null);
    assert.equal(normalizeDateKey('18/08/2026'), null);
});

test('nhân viên không thể đăng ký ngày trước ngày hiện tại', () => {
    assert.deepEqual(
        validateScheduleDates({
            days: [{ date: '2026-08-17', shift_type: 'CA_SANG' }],
            today: '2026-08-18'
        }),
        { valid: false, reason: 'PAST_DATE', date: '2026-08-17' }
    );
});

test('nhân viên vẫn đăng ký được hôm nay và tương lai', () => {
    assert.deepEqual(
        validateScheduleDates({
            days: [
                { date: '2026-08-18', shift_type: 'CA_SANG' },
                { date: '2026-08-19', shift_type: 'OFF' }
            ],
            today: '2026-08-18'
        }),
        { valid: true }
    );
});

test('Admin được sửa lịch sử nhưng không được gửi ngày sai định dạng', () => {
    assert.deepEqual(
        validateScheduleDates({
            days: [{ date: '2026-08-17', shift_type: 'CA_SANG' }],
            today: '2026-08-18',
            isAdmin: true
        }),
        { valid: true }
    );
    assert.equal(
        validateScheduleDates({
            days: [{ date: 'invalid', shift_type: 'CA_SANG' }],
            today: '2026-08-18',
            isAdmin: true
        }).reason,
        'INVALID_DATE'
    );
});
