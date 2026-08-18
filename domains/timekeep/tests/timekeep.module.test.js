import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTimekeepModule } from '../index.js';
import {
    isValidShift, buildEmployeeCode, checkRegistrationInput,
    extractSheetId, attendanceStatus, formatCheckInTime, SHIFT_TYPES
} from '../domain/timekeep-rules.js';
import { getTodayVN, getIsoWeekRangeVN } from '../domain/vn-time.js';
import { createToggleScheduleRegistration } from '../application/toggle-schedule-registration.js';
import { createManageAdminSchedules } from '../application/manage-admin-schedules.js';

const DOMAIN_DIR = fileURLToPath(new URL('../', import.meta.url));
const BOT_FILE = fileURLToPath(new URL('../../../apps/bot/timekeep_bot.js', import.meta.url));
const readBot = () => fs.readFileSync(BOT_FILE, 'utf8');

function createHarness() {
    const routes = [];
    const crons = [];
    let queryCount = 0;

    const moduleApi = registerTimekeepModule({
        botApp: {
            get(p, ...h) { routes.push({ method: 'GET', path: p, handlers: h }); },
            post(p, ...h) { routes.push({ method: 'POST', path: p, handlers: h }); },
            put(p, ...h) { routes.push({ method: 'PUT', path: p, handlers: h }); },
            delete(p, ...h) { routes.push({ method: 'DELETE', path: p, handlers: h }); }
        },
        pool: {
            async query() { queryCount += 1; throw new Error('Không được truy vấn database lúc đăng ký module'); },
            async connect() { throw new Error('Không được mở kết nối lúc đăng ký module'); }
        },
        cron: { schedule(expression, handler) { crons.push({ expression, handler }); return { stop() {} }; } },
        kpiGroupRoles: ['report', 'report_tour'],
        registerEmployeeInKpiGroup: async () => ({ ok: true }),
        syncAllTimekeepSheets: async () => ({ success: true }),
        adminIds: () => '111,222',
        spreadsheetId: 'SHEET-TEST'
    });

    return { routes, crons, queryCount, moduleApi };
}

/* ---------- Hợp đồng: đổi là gãy Web Admin / Mini App đang chạy ---------- */

test('module đăng ký đúng 8 endpoint cũ và không chạm database lúc khởi động', () => {
    const h = createHarness();
    assert.deepEqual(h.routes.map(r => `${r.method} ${r.path}`), [
        'POST /api/timekeep/register',
        'POST /api/timekeep/schedule/toggle',
        'PUT /api/tk_group_settings/:telegram_group_id',
        'GET /api/admin/dashboard',
        'PUT /api/admin/schedules/:id',
        'POST /api/admin/schedules',
        'DELETE /api/admin/schedules/:id',
        'POST /api/admin/timekeep/sync-sheet'
    ]);
    assert.equal(h.queryCount, 0);
    assert.equal(Object.isFrozen(h.moduleApi), true);
});

test('cron xuất Sheet giữ đúng 23:00 hằng ngày', () => {
    assert.deepEqual(createHarness().crons.map(c => c.expression), ['0 23 * * *']);
});

test('module phải đăng ký SAU middleware xác thực /api/timekeep', () => {
    // botApp.use('/api/timekeep', authenticateTelegramMiniApp) chỉ áp cho route
    // đăng ký SAU nó. Dời lời gọi module lên trên là POST /api/timekeep/register
    // mất lớp xác thực Telegram — ai cũng đăng ký hộ người khác được.
    const source = readBot();
    const authAt = source.indexOf("botApp.use('/api/timekeep', authenticateTelegramMiniApp)");
    const moduleAt = source.indexOf('registerTimekeepModule({');
    assert.ok(authAt > 0, 'không tìm thấy middleware xác thực');
    assert.ok(moduleAt > 0, 'không tìm thấy lời gọi module');
    assert.ok(authAt < moduleAt, 'registerTimekeepModule phải đứng SAU middleware xác thực');
});

/* ---------- Quy tắc nghiệp vụ ---------- */

test('bốn ca trực hợp lệ, không nhận ca lạ', () => {
    assert.deepEqual(SHIFT_TYPES, ['CA_SANG', 'CA_CHIEU', 'FULL_DAY', 'OFF']);
    for (const s of SHIFT_TYPES) assert.equal(isValidShift(s), true);
    for (const s of ['ca_sang', 'NIGHT', '', null, undefined]) assert.equal(isValidShift(s), false);
});

test('thiếu thông tin đăng ký thì chặn, thiếu nhóm báo riêng', () => {
    const full = { telegramId: '1', fullName: 'A', role: 'Nhân viên', telegramGroupId: '-100' };
    assert.equal(checkRegistrationInput(full).ok, true);

    for (const miss of ['telegramId', 'fullName', 'role']) {
        const verdict = checkRegistrationInput({ ...full, [miss]: '' });
        assert.equal(verdict.ok, false, miss);
        assert.match(verdict.message, /Thiếu thông tin đăng ký bắt buộc/);
    }

    // Thiếu nhóm là lỗi thao tác, phải chỉ đúng cách mở lại Mini App.
    const noGroup = checkRegistrationInput({ ...full, telegramGroupId: '' });
    assert.equal(noGroup.ok, false);
    assert.match(noGroup.message, /liên kết Đăng ký trong nhóm/);
});

test('mã nhân viên tự sinh không trùng khi hai người đăng ký cùng lúc', () => {
    assert.equal(buildEmployeeCode('999', 1700000001234), 'EMP-999-1234');
    assert.notEqual(buildEmployeeCode('999', 1700000001234), buildEmployeeCode('999', 1700000005678));
});

test('Admin dán cả link Google Sheet vẫn lấy đúng mã', () => {
    assert.equal(
        extractSheetId('https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0'),
        '1AbC-dEf_123'
    );
    assert.equal(extractSheetId('  1AbC-dEf_123  '), '1AbC-dEf_123');
    assert.equal(extractSheetId(''), null);
    assert.equal(extractSheetId(null), null);
});

test('trạng thái chấm công xét đúng thứ tự', () => {
    const base = { hasSchedule: true, shiftType: 'CA_SANG', hasCheckIn: true, lateMinutes: 0 };
    assert.equal(attendanceStatus({ ...base, hasSchedule: false }), 'NO_SCHEDULE');
    assert.equal(attendanceStatus({ ...base, shiftType: 'OFF' }), 'OFF');
    assert.equal(attendanceStatus({ ...base, hasCheckIn: false }), 'NOT_CHECKED_IN');
    assert.equal(attendanceStatus({ ...base, lateMinutes: 5 }), 'LATE');
    assert.equal(attendanceStatus(base), 'ON_TIME');
    // Nghỉ thì không tính là chưa check-in, dù thực tế chưa check-in.
    assert.equal(attendanceStatus({ ...base, shiftType: 'OFF', hasCheckIn: false }), 'OFF');
});

test('giờ hiển thị và mốc ngày luôn theo UTC+7, không theo giờ máy', () => {
    // 2026-08-17T22:30:00Z = 05:30 ngày 18/08 giờ Việt Nam.
    assert.equal(formatCheckInTime('2026-08-17T22:30:00Z'), '05:30');
    assert.equal(formatCheckInTime(null), null);

    assert.match(getTodayVN(), /^\d{4}-\d{2}-\d{2}$/);
    const week = getIsoWeekRangeVN();
    assert.match(week.start, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(week.start <= week.end);
    assert.equal((new Date(week.end) - new Date(week.start)) / 86400000, 6, 'tuần ISO đúng 7 ngày');
});

test('chỉ Quản lý hoặc Admin hệ thống được mở/đóng đăng ký lịch', async () => {
    let toggled = 0;
    const build = role => createToggleScheduleRegistration({
        repository: {
            async findCallerWithFlag() {
                return { role, group_id: 'g1', schedule_registration_open: false };
            },
            async setRegistrationOpen() { toggled += 1; }
        },
        isSystemAdmin: id => id === '111'
    });

    assert.equal((await build('Nhân viên')({ telegramId: '999', chatId: '-100' })).status, 403);
    assert.equal(toggled, 0, 'bị từ chối thì không được ghi database');

    for (const role of ['Quản lý', 'Quản lý kho']) {
        const out = await build(role)({ telegramId: '999', chatId: '-100' });
        assert.equal(out.ok, true, role);
        assert.equal(out.newState, true, 'đang đóng thì bấm phải MỞ');
    }

    // Admin hệ thống bấm được dù vai trò chỉ là Nhân viên.
    assert.equal((await build('Nhân viên')({ telegramId: '111', chatId: '-100' })).ok, true);
    assert.equal((await build('Quản lý')({ telegramId: '', chatId: '-100' })).status, 400);
});

test('xoá ca trực mới đồng bộ Sheet, ca không tồn tại thì không', async () => {
    let synced = 0;
    let existing = true;
    const manage = createManageAdminSchedules({
        repository: {
            async deleteSchedule() { return existing ? { id: 's1' } : null; },
            async updateShift() { return { id: 's1' }; },
            async findGroupIdOfEmployee() { return 'g1'; },
            async upsertSchedule(values) { return { id: 's1', ...values }; }
        },
        syncSheets: async () => { synced += 1; }
    });

    assert.equal((await manage.deleteSchedule('s1')).ok, true);
    assert.equal(synced, 1);

    existing = false;
    assert.equal((await manage.deleteSchedule('s404')).status, 404);
    assert.equal(synced, 1, 'không tìm thấy lịch thì không được gọi Google');

    assert.equal((await manage.updateShift('s1', 'NIGHT')).status, 400, 'ca lạ phải bị chặn');
    assert.equal((await manage.createSchedule({ userId: '', date: '', shiftType: '' })).status, 400);
});

/* ---------- Còn nợ: khoá lại để test không báo sai là đã xong ---------- */

test('timekeep_bot.js đã hết 8 chức năng đã tách', () => {
    const source = readBot();
    assert.match(source, /registerTimekeepModule\(\{/);
    for (const gone of [
        /botApp\.post\('\/api\/timekeep\/register'/,
        /botApp\.post\('\/api\/timekeep\/schedule\/toggle'/,
        /botApp\.put\('\/api\/tk_group_settings\//,
        /botApp\.get\('\/api\/admin\/dashboard'/,
        /botApp\.(put|post|delete)\('\/api\/admin\/schedules/,
        /botApp\.post\('\/api\/admin\/timekeep\/sync-sheet'/,
        /cron\.schedule\('0 23 \* \* \*'/,
        /function getTodayVN\(\)/,
        /function getIsoWeekRangeVN\(\)/
    ]) {
        assert.doesNotMatch(source, gone, `còn sót trong timekeep_bot.js: ${gone}`);
    }
});

test('CÒN NỢ: phần lõi vẫn ở timekeep_bot.js, đừng báo nhầm là đã xong', () => {
    // Bảy khối này nằm chồng lên vùng một agent khác đang sửa dở tính năng đơn
    // nghỉ đột xuất. Tách bây giờ sẽ xoá mất công việc chưa commit của họ.
    // Khi họ commit xong thì gỡ dần các dòng dưới đây.
    const source = readBot();
    for (const stillHere of [
        /botApp\.get\('\/api\/timekeep\/schedule\/data'/,
        /botApp\.post\('\/api\/timekeep\/schedule\/save'/,
        /botApp\.post\('\/api\/timekeep\/leave-request\/save'/,
        /botApp\.post\('\/api\/timekeep\/checkin\/save'/,
        /botApp\.get\('\/api\/timekeep\/personal-stats'/,
        /async function sendSundayScheduleReminder/,
        /bot\.action\(\/\^\(approve\|reject\)_leave_/
    ]) {
        assert.match(source, stillHere, `đã tách rồi thì cập nhật lại test này: ${stillHere}`);
    }
});

/* ---------- Luật kiến trúc, nhân bản từ domains/warehouse ---------- */

/**
 * Ba file phẳng ở gốc domain CỐ Ý chưa xếp vào tầng: cả ba đang được agent khác
 * import từ đúng những dòng họ vừa sửa. Xếp lại bây giờ là hỏng import của họ.
 */
const PENDING_FLAT_FILES = [
    'attendance-penalties.js',
    'leave-request-service.js',
    'schedule-date-policy.js'
];

function domainFiles() {
    return fs.readdirSync(DOMAIN_DIR, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js')
            && !entry.startsWith('tests/')
            && !PENDING_FLAT_FILES.includes(entry));
}

const readFile = rel => fs.readFileSync(path.join(DOMAIN_DIR, rel), 'utf8');
const stripComments = src =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('đủ 4 tầng và một cổng index.js duy nhất', () => {
    for (const required of ['index.js', 'README.md', 'domain', 'application', 'infrastructure', 'interfaces']) {
        assert.ok(fs.existsSync(path.join(DOMAIN_DIR, required)), `thiếu ${required}`);
    }
});

test('tầng domain không phụ thuộc express, pg, telegraf hay Google API', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            assert.ok(match[1].startsWith('.'), `${file} không được import thư viện ngoài: ${match[1]}`);
        }
    }
});

test('chỉ tầng infrastructure được viết SQL', () => {
    const SQL = /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/;
    for (const file of domainFiles()) {
        if (file.startsWith('infrastructure/')) continue;
        assert.ok(!SQL.test(stripComments(readFile(file))),
            `${file} chứa SQL — mọi truy vấn phải nằm trong infrastructure/postgres/`);
    }
});

test('domain không được phụ thuộc ngược lên tầng trên', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
            assert.ok(target.startsWith('domain/') || !target.includes('/'),
                `${file} không được phụ thuộc tầng trên: ${target}`);
        }
    }
});

test('application không được biết tới interfaces', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('application/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            assert.ok(!match[1].includes('interfaces/'), `${file} không được import interfaces: ${match[1]}`);
        }
    }
});

test('mọi import tương đối trong domain đều trỏ tới file có thật', () => {
    for (const file of domainFiles()) {
        for (const match of readFile(file).matchAll(/from\s+'(\.[^']+)'/g)) {
            const target = path.resolve(path.dirname(path.join(DOMAIN_DIR, file)), match[1]);
            assert.ok(fs.existsSync(target), `${file} -> ${match[1]} không tồn tại`);
        }
    }
});

test('không file nào trong domain vượt 300 dòng', () => {
    const tooLong = domainFiles()
        .map(file => ({ file, lines: readFile(file).split('\n').length }))
        .filter(entry => entry.lines > 300)
        .map(entry => `${entry.file} (${entry.lines} dòng)`);
    assert.deepEqual(tooLong, [], 'Các file sau cần được tách nhỏ');
});
