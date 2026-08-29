import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./StaffManagement.jsx', import.meta.url), 'utf8');
const settingsModal = fs.readFileSync(new URL('./StaffGroupSettingsModal.jsx', import.meta.url), 'utf8');

test('Danh sách nhân sự gom thông tin thành sáu cột dễ đọc', () => {
  for (const heading of ['Nhân viên', 'Vai trò & nhóm', 'Trạng thái']) {
    assert.match(source, new RegExp(heading));
  }
  assert.match(source, /min-w-\[1120px\]/);
  assert.match(source, /grid-cols-\[44px_minmax\(260px,1\.1fr\)/);
  assert.doesNotMatch(source, /<th/);
});

test('Thông tin phụ không bị mất khi rút gọn bảng', () => {
  assert.match(source, /user\.telegram_id/);
  assert.match(source, /user\.created_at/);
  assert.match(source, /membership\.membership_status/);
});

test('mỗi Telegram ID chỉ hiển thị một dòng và giữ đủ vai trò theo nhóm', () => {
  assert.match(source, /groupStaffIdentities\(staff\)/);
  assert.match(source, /<StaffMembershipList memberships=\{user\.memberships\}/);
  assert.match(source, /value=\{groupedStaff\.length\}/);
  assert.match(source, /key=\{user\.identity_key\}/);
});

test('danh sách không chỉnh trực tiếp nhưng có nút mở route hồ sơ', () => {
  assert.doesNotMatch(source, /StaffGroupSettingsModal|saveGroupSettings|>Quyền kho</);
  assert.match(settingsModal, /Chỉ áp dụng tại nhóm này/);
  assert.match(source, /Sửa và xem thống kê/);
  assert.match(source, /onClick=\{\(\) => openEmployeeProfile\(user\)\}/);
});

test('điện thoại dùng thẻ nhân sự, desktop dùng bảng riêng', () => {
  assert.match(source, /divide-y divide-slate-100 md:hidden/);
  assert.match(source, /hidden overflow-x-auto md:block/);
  assert.match(source, /active:bg-blue-50/);
});

test('thanh danh sách lọc độc lập theo tên, vai trò và nhóm', () => {
  assert.match(source, /Lọc theo tên hoặc Telegram ID/);
  assert.match(source, /Tất cả vai trò/);
  assert.match(source, /Tất cả nhóm/);
  assert.match(source, /matchesName && matchesRole && matchesGroup/);
  assert.match(source, /sm:grid-cols-3/);
});

test('Admin có khu vực duyệt đăng ký và phải chọn hồ sơ đích', () => {
  assert.match(source, /Yêu cầu đăng ký chờ duyệt/);
  assert.match(source, /registration-requests/);
  assert.match(source, /target_employee_id/);
  assert.match(source, /Gắn vào hồ sơ nhân viên/);
  assert.match(source, /approveRegistration\(request\)/);
  assert.match(source, /rejectRegistration\(request\)/);
});

test('giao diện hiển thị đầy đủ lịch sử ACTIVE và REJECTED', () => {
  assert.match(source, /Lịch sử đăng ký gần đây/);
  assert.match(source, /PENDING · Chờ duyệt/);
  assert.match(source, /ACTIVE · Đã duyệt/);
  assert.match(source, /REJECTED · Từ chối/);
  assert.match(source, /request\.rejection_reason/);
  assert.match(source, /request\.reviewed_by/);
  assert.match(source, /request\.reviewed_at/);
});
