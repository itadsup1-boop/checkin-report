import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./StaffManagement.jsx', import.meta.url), 'utf8');

test('Danh sách nhân sự gom thông tin thành sáu cột dễ đọc', () => {
  for (const heading of ['Nhân viên', 'Vai trò & nhóm', 'Thiết lập nhân sự', 'Trạng thái', 'Thao tác']) {
    assert.match(source, new RegExp(heading));
  }
  assert.match(source, /min-w-\[1120px\]/);
  assert.match(source, /grid-cols-\[44px_minmax\(230px,1\.35fr\)/);
  assert.doesNotMatch(source, /<th/);
});

test('Thông tin phụ không bị mất khi rút gọn bảng', () => {
  assert.match(source, /user\.telegram_id/);
  assert.match(source, /user\.created_at/);
  assert.match(source, /user\.leave_quota/);
  assert.match(source, /user\.is_exempt_checkin/);
  assert.match(source, /user\.need_report/);
  assert.match(source, /user\.membership_status/);
  assert.match(source, /user\.is_active/);
});

test('Chỉnh sửa và tạm dừng theo nhóm vẫn được giữ nguyên', () => {
  assert.match(source, /saveEdit\(user\.id\)/);
  assert.match(source, /updateMembershipStatus\(user\)/);
  assert.match(source, /PAUSABLE_GROUP_ROLES\.includes\(user\.selected_group_role\)/);
  assert.match(source, /telegram_group_id: selectedGroupId/);
});
