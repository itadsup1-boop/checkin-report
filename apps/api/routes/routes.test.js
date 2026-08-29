import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiSource = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const routeModules = [
    'admin-account-routes.js',
    'staff-routes.js',
    'attendance-routes.js',
    'schedule-routes.js',
    'leave-routes.js',
    'employee-routes.js',
    'group-routes.js',
    'proxy-routes.js'
];

test('API entry point chỉ lắp ghép các registrar nghiệp vụ', () => {
    for (const file of routeModules) {
        const registrar = file
            .replace('-routes.js', '')
            .split('-')
            .map(part => part[0].toUpperCase() + part.slice(1))
            .join('');
        assert.match(apiSource, new RegExp(`register${registrar}Routes`), file);
    }
    assert.doesNotMatch(apiSource, /app\.(get|post|put|delete)\('\/api\/admin\/(accounts|tk-users|checkins|schedules|leave-requests)/);
    assert.ok(apiSource.split('\n').length < 200, 'apps/api/index.js không được phình lại thành god file');
});

test('các endpoint cũ vẫn được đăng ký trong module tương ứng', () => {
    const expected = new Map([
        ['admin-account-routes.js', ['/api/admin/accounts']],
        ['staff-routes.js', ['/api/admin/tk-users', '/group-settings', '/group-membership']],
        ['attendance-routes.js', ['/api/admin/checkins']],
        ['schedule-routes.js', ['/api/admin/schedules', '/api/admin/schedules/stats']],
        ['leave-routes.js', ['/api/admin/leave-requests', '/api/admin/leave-balances']],
        ['employee-routes.js', ['/api/employees', '/report-status']],
        ['group-routes.js', ['/api/groups', '/settings']],
        ['proxy-routes.js', ['/api/bot/get-report-today', '/mini-app']]
    ]);
    for (const [file, paths] of expected) {
        const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
        for (const route of paths) assert.ok(source.includes(route), `${file} thiếu ${route}`);
    }
});
