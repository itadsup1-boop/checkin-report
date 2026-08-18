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
    const source = fs.readFileSync(new URL('./timekeep_bot.js', import.meta.url), 'utf8');
    const usages = source.match(/findEmployeeForTimekeepContext\(pool, telegram_id, chat_id\)/g) || [];
    const routeStart = source.indexOf("botApp.get('/api/timekeep/personal-stats'");
    const routeEnd = source.indexOf('\nbotApp.', routeStart + 1);
    const personalStatsRoute = source.slice(routeStart, routeEnd);

    assert.equal(usages.length, 5);
    assert.doesNotMatch(
        personalStatsRoute,
        /SELECT id, full_name, role, group_id FROM employees WHERE telegram_id = \$1 LIMIT 1/
    );
});
