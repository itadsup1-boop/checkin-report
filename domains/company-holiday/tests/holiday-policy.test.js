import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHolidayAnnouncement, validateHolidayInput } from '../index.js';

test('accepts a single company holiday date', () => {
    assert.deepEqual(validateHolidayInput({ name: 'Quốc khánh', start_date: '2026-09-02', end_date: '2026-09-02' }), {
        name: 'Quốc khánh', startDate: '2026-09-02', endDate: '2026-09-02', note: ''
    });
});

test('rejects a reversed company holiday range', () => {
    assert.throws(
        () => validateHolidayInput({ name: 'Sai', start_date: '2026-09-03', end_date: '2026-09-02' }),
        /Ngày kết thúc/
    );
});

test('one range produces one announcement containing both boundary dates', () => {
    const text = buildHolidayAnnouncement({
        name: 'Kỳ nghỉ', start_date: '2026-09-02', end_date: '2026-09-04', note: 'Chúc mọi người nghỉ vui.'
    });
    assert.match(text, /02\/09\/2026/);
    assert.match(text, /04\/09\/2026/);
    assert.match(text, /không cần check-in/);
    assert.match(text, /không phải gửi báo cáo KPI/);
});
