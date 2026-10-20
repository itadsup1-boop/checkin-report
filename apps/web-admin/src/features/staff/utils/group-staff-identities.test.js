import test from 'node:test';
import assert from 'node:assert/strict';
import { groupStaffIdentities } from './group-staff-identities.js';

test('gom nhiều hồ sơ cùng Telegram thành một nhân sự với đủ nhóm và vai trò', () => {
  const result = groupStaffIdentities([
    { id: 'employee-1', telegram_id: '8655607118', full_name: 'Nguyễn Thị Hoa Huệ', role: 'Sales', group_name: 'Nhóm lịch', telegram_group_id: '-1', created_at: '2026-07-22' },
    { id: 'employee-2', telegram_id: '8655607118', full_name: 'Nguyễn Thị Hoa Huệ', role: 'Quản lý kho', group_name: 'Nhóm kho', telegram_group_id: '-2', created_at: '2026-08-17' }
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0].employee_ids, ['employee-1', 'employee-2']);
  assert.deepEqual(result[0].roles, ['Sales', 'Quản lý kho']);
  assert.deepEqual(result[0].memberships.map(item => item.group_name), ['Nhóm lịch', 'Nhóm kho']);
});

test('không gom hai hồ sơ thiếu Telegram ID chỉ vì trùng tên', () => {
  const result = groupStaffIdentities([
    { id: 'employee-1', full_name: 'Trùng tên' },
    { id: 'employee-2', full_name: 'Trùng tên' }
  ]);

  assert.equal(result.length, 2);
});

test('cùng Telegram và cùng nhóm chỉ hiển thị membership mới nhất một lần', () => {
  const result = groupStaffIdentities([
    { id: 'new-profile', telegram_id: '5397256902', role: 'Kỹ thuật viên', telegram_group_id: '-1', group_name: 'Nhóm báo hẹn', need_report: true },
    { id: 'old-profile', telegram_id: '5397256902', role: 'Kỹ thuật viên', telegram_group_id: '-1', group_name: 'Nhóm báo hẹn', need_report: false }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].memberships.length, 1);
  assert.equal(result[0].memberships[0].employee_id, 'new-profile');
  assert.equal(result[0].memberships[0].need_report, true);
});
