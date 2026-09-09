import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const detail = fs.readFileSync(new URL('./EmployeeDetailPage.jsx', import.meta.url), 'utf8');
const calendar = fs.readFileSync(new URL('./EmployeeMonthCalendar.jsx', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../../../app/App.jsx', import.meta.url), 'utf8');
const staff = fs.readFileSync(new URL('../StaffManagement.jsx', import.meta.url), 'utf8');
const profileApi = fs.readFileSync(new URL('../api/employee-profile-api.js', import.meta.url), 'utf8');
const groupManagement = fs.readFileSync(new URL('./EmployeeGroupManagement.jsx', import.meta.url), 'utf8');

test('router có URL hồ sơ nhân viên và vẫn nằm trong AdminLayout', () => {
  assert.match(app, /path="\/nhan-su\/:employeeId"/);
  assert.match(app, /<EmployeeDetailPage selectedGroupId=\{selectedGroupId\}/);
});

test('danh sách mở hồ sơ và giữ nhóm đang lọc', () => {
  assert.match(staff, /\/nhan-su\/\$\{user\.id\}/);
  assert.match(staff, /params\.set\('nhom', selectedGroupId\)/);
  assert.match(staff, /aria-label=\{`Mở hồ sơ nhân viên/);
});

test('trang chi tiết giữ tháng trên URL và chia thành component nhỏ', () => {
  assert.match(detail, /searchParams\.get\('thang'\)/);
  assert.match(detail, /next\.set\('thang', value\)/);
  for (const component of ['EmployeeProfileHeader', 'MonthNavigator', 'MonthlySummaryCards', 'EmployeeMonthCalendar', 'DayDetailPanel', 'AttendanceMonthlySection', 'KpiMonthlySection']) {
    assert.match(detail, new RegExp(`<${component}`));
  }
});

test('API hồ sơ luôn gửi Bearer token ngay từ request đầu tiên', () => {
  assert.match(profileApi, /localStorage\.getItem\('admin_token'\)/);
  assert.match(profileApi, /Authorization: `Bearer \$\{token\}`/);
});

test('calendar là bảy cột và cho phép mở chi tiết ngày', () => {
  assert.match(calendar, /grid-cols-7/);
  assert.match(calendar, /onSelectDate\(date\)/);
  assert.match(calendar, /dayBadges/);
});

test('thiết lập từng nhóm nằm ngay dưới thẻ hồ sơ nhân viên', () => {
  assert.match(detail, /<EmployeeProfileHeader[\s\S]*<EmployeeGroupManagement[\s\S]*<MonthNavigator/);
  assert.match(groupManagement, /Thiết lập theo nhóm/);
  assert.match(groupManagement, /StaffGroupSettingsModal/);
  assert.match(groupManagement, /group-membership/);
  assert.match(groupManagement, /Quyền kho/);
});
