import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findEmployeeForTimekeepContext } from './timekeep-employee-context.js';

test('ưu tiên hồ sơ của đúng nhóm khi một Telegram ID thuộc nhiều nhóm', async () => {
    const expected = { id: 'mdt-employee', full_name: 'Trang' };
    const calls = [];
    const pool = {
        async query(sql, params) {
            calls.push({ sql, params });
            return { rows: [expected] };
        }
    };

    const employee = await findEmployeeForTimekeepContext(pool, 8031762214, -1002224124601);

    assert.equal(employee, expected);
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /telegram_group\.telegram_group_id = \$2/);
    assert.deepEqual(calls[0].params, ['8031762214', '-1002224124601']);
});

test('chỉ dùng hồ sơ toàn cục làm dự phòng khi không có hồ sơ trong nhóm', async () => {
    const fallback = { id: 'fallback-employee' };
    const pool = {
        calls: 0,
        async query() {
            this.calls += 1;
            return this.calls === 1 ? { rows: [] } : { rows: [fallback] };
        }
    };

    const employee = await findEmployeeForTimekeepContext(pool, '123', '-456');

    assert.equal(employee, fallback);
    assert.equal(pool.calls, 2);
});

test('mọi API chấm công theo nhóm dùng chung bộ nhận diện hồ sơ', () => {
    // 5 dịch vụ chuyển vào domains/timekeep/application/ đều gọi qua
    // findEmployeeContext (bó sẵn findEmployeeForTimekeepContext + pool ở
    // domains/timekeep/index.js) thay vì tự viết SQL lấy hồ sơ riêng.
    const domainFiles = [
        'get-schedule-view.js', 'save-weekly-schedule.js', 'save-leave-request.js',
        'save-checkin.js', 'get-personal-stats.js'
    ];
    let usageCount = 0;
    for (const file of domainFiles) {
        const source = fs.readFileSync(
            new URL(`../../domains/timekeep/application/${file}`, import.meta.url), 'utf8');
        const matches = source.match(/findEmployeeContext\(telegramId, chatId\)/g) || [];
        assert.ok(matches.length > 0, `${file} phải gọi findEmployeeContext`);
        usageCount += matches.length;
    }
    assert.equal(usageCount, 5);

    const personalStatsSource = fs.readFileSync(
        new URL('../../domains/timekeep/application/get-personal-stats.js', import.meta.url), 'utf8');
    assert.doesNotMatch(
        personalStatsSource,
        /SELECT id, full_name, role, group_id FROM employees WHERE telegram_id = \$1 LIMIT 1/
    );
});
