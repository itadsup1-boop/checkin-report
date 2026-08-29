import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const staffSource = fs.readFileSync(new URL('./StaffManagement.jsx', import.meta.url), 'utf8');
const checkinSource = fs.readFileSync(new URL('./CheckinManagement.jsx', import.meta.url), 'utf8');
const botSource = fs.readFileSync(new URL('../../bot/timekeep_bot.js', import.meta.url), 'utf8');

test('Menu chỉ còn các nghiệp vụ không trùng lặp', () => {
  for (const label of ['Tổng quan', 'Nhân sự', 'Điểm danh', 'Lịch làm việc', 'Nghỉ phép & Quỹ phép', 'Cấu hình nhóm']) {
    assert.match(appSource, new RegExp(`label: '${label}'`));
  }
  assert.doesNotMatch(appSource, /PermissionManagement|Phân quyền thành viên|activeTab === 'overview'/);
});

test('Menu điện thoại có thao tác mở, đóng và lớp nền', () => {
  assert.match(appSource, /setMobileSidebarOpen\(true\)/);
  assert.match(appSource, /setMobileSidebarOpen\(false\)/);
  assert.match(appSource, /aria-label="Mở menu"/);
  assert.match(appSource, /aria-label="Đóng menu"/);
});

test('Không còn thanh tìm kiếm và chuông thông báo giả', () => {
  assert.doesNotMatch(appSource, /placeholder="Tìm kiếm nhân viên/);
  assert.doesNotMatch(appSource, /<Bell|bg-red-500 rounded-full/);
});

test('Xuất Excel nằm tại Điểm danh và lọc theo ngày, nhóm', () => {
  assert.doesNotMatch(staffSource, /export\/today|Xuất Excel/);
  assert.match(checkinSource, /export\/today/);
  assert.match(checkinSource, /date: selectedDate/);
  assert.match(checkinSource, /group_id: selectedGroupId/);
  assert.match(botSource, /const requestedGroupId = req\.query\.group_id/);
  assert.match(botSource, /const exportGroupIds = requestedGroupId/);
});

test('Web Admin xác minh session và chỉ gửi Bearer token', () => {
  assert.match(appSource, /\/admin\/session/);
  assert.match(appSource, /Authorization = `Bearer \$\{token\}`/);
  assert.match(appSource, /\/admin\/logout/);
  assert.doesNotMatch(appSource, /x-admin-id|x-admin-role/);
});
