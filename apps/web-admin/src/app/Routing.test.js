import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');
const apiSource = fs.readFileSync(new URL('../../api/index.js', import.meta.url), 'utf8');
const dashboardSource = fs.readFileSync(new URL('./DashboardTab.jsx', import.meta.url), 'utf8');

/** Đường dẫn của từng mục menu. Đổi là đứt link cũ người dùng đã lưu. */
const ROUTES = [
    ['dashboard', '/dashboard'],
    ['staff', '/nhan-su'],
    ['checkins', '/diem-danh'],
    ['schedules', '/lich-lam-viec'],
    ['leave', '/nghi-phep'],
    ['warehouse', '/kho'],
    ['settings', '/cau-hinh'],
    ['admins', '/tai-khoan']
];

test('mỗi mục menu có một đường dẫn riêng', () => {
    for (const [id, path] of ROUTES) {
        assert.match(appSource, new RegExp(`id: '${id}', path: '${path}'`),
            `thiếu đường dẫn cho mục ${id}`);
    }
});

test('mọi đường dẫn đều được khai báo thành Route', () => {
    for (const [, path] of ROUTES) {
        // /kho dùng dạng "/kho/*" để sau này thêm màn hình con.
        assert.ok(
            appSource.includes(`path="${path}"`) || appSource.includes(`path="${path}/*"`),
            `chưa khai báo <Route path="${path}">`
        );
    }
});

test('menu KHÔNG còn nằm trong state — đó là lý do reload bị về trang chủ', () => {
    // useState('dashboard') là lỗi cũ: F5 là mất chỗ đang đứng.
    assert.doesNotMatch(appSource, /useState\('dashboard'\)/);
    assert.doesNotMatch(appSource, /setActiveTab/);
    assert.match(appSource, /<Routes>/);
});

test('nhóm đang lọc nằm trên URL, reload không mất bộ lọc', () => {
    assert.match(appSource, /GROUP_PARAM = 'nhom'/);
    assert.match(appSource, /searchParams\.get\(GROUP_PARAM\)/);
    // Đổi nhóm dùng replace để nút Quay lại không kẹt ở từng lần đổi.
    assert.match(appSource, /\{ replace: true \}/);
    assert.doesNotMatch(appSource, /useState\('ALL'\)/);
});

test('mục menu sáng theo đường dẫn thật, không đọc window.location', () => {
    // Đọc thẳng window thì React không biết đường dẫn đổi, ô menu đứng yên
    // ở mục cũ — đúng loại lỗi đã gặp ở tab chi nhánh của Mini App tồn kho.
    assert.match(appSource, /useLocation\(\)/);
    assert.doesNotMatch(appSource, /window\.location\.pathname/);
});

test('BrowserRouter dùng đường dẫn thật, không phải dấu thăng', () => {
    assert.match(mainSource, /BrowserRouter/);
    assert.doesNotMatch(mainSource, /HashRouter/);
});

test('máy chủ trả index.html cho đường dẫn sâu, nếu không reload sẽ 404', () => {
    // Không có chốt này thì mở thẳng /kho là lỗi 404 chứ không vào được app.
    assert.match(apiSource, /res\.sendFile\(path\.join\(webAdminPath, 'index\.html'\)\)/);
});

test('màn hình không đủ quyền chỉ bị chặn SAU khi tải xong danh sách nhóm', () => {
    // Xét sớm thì `groups` còn rỗng, người có quyền kho bị báo sai là chưa được cấp quyền.
    assert.match(appSource, /if \(!groupsLoaded\) return null/);
    assert.match(appSource, /!groupsLoaded/);
    assert.match(appSource, /showWarehouse[\s\S]*<WarehouseManagement \/>/);
    assert.match(appSource, /<WarehouseAccessNotice \/>/);
    assert.match(appSource, /guard\(isSuperAdmin\)/);
});

test('đường dẫn lạ về Tổng quan, không để trang trắng', () => {
    assert.match(appSource, /path="\*"/);
    assert.match(appSource, /<Navigate to=\{PATH_BY_ID\.dashboard\} replace \/>/);
});

test('giữ nguyên chữ ký onNavigate cũ mà Tổng quan đang gọi', () => {
    // DashboardTab gọi onNavigate('checkins') — đổi sang truyền đường dẫn là gãy.
    assert.match(dashboardSource, /onNavigate\?\.\('checkins'\)/);
    assert.match(dashboardSource, /onNavigate\?\.\('leave'\)/);
    assert.match(appSource, /PATH_BY_ID\[tab\]/);
});
