import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./DashboardTab.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');
const botSource = fs.readFileSync(new URL('../../bot/timekeep_bot.js', import.meta.url), 'utf8');

test('Tổng quan dùng bố cục gọn bốn thẻ và hai danh sách', () => {
  for (const label of [
    'Tổng nhân sự',
    'Đúng giờ hôm nay',
    'Đến muộn',
    'Vắng chưa phép',
    'Chấm công gần đây',
    'Nghỉ phép chờ duyệt'
  ]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /xl:grid-cols-4/);
  assert.match(source, /xl:grid-cols-\[minmax\(0,2fr\)_minmax\(320px,1fr\)\]/);
  assert.doesNotMatch(source, /Nhân sự hôm nay/);
  assert.doesNotMatch(source, /Tiền phạt tuần/);
});

test('Tổng quan có thể mở màn chi tiết và duyệt nhanh đơn nghỉ', () => {
  assert.match(source, /onNavigate\?\.\('checkins'\)/);
  assert.match(source, /onNavigate\?\.\('leave'\)/);
  assert.match(source, /status: 'APPROVED'/);
  assert.match(appSource, /onNavigate=\{navigateTo\}/);
});

test('Đơn nghỉ trên Tổng quan có ngày, lý do và chỉ lấy ngày trong tương lai', () => {
  assert.match(source, /Ngày muốn nghỉ/);
  assert.match(source, /Lý do/);
  assert.match(source, /formatLeaveDate\(request\.date\)/);
  assert.match(source, /request\.reason \|\| 'Không ghi lý do'/);
  assert.match(source, /leaveDateKey\(request\.date\) > today/);
  assert.match(source, /Không có đơn tương lai chờ duyệt/);
});

test('API Dashboard hiểu cả Telegram Group ID và lựa chọn tất cả nhóm', () => {
  assert.match(botSource, /g\.telegram_group_id\) === String\(group_id\)/);
  assert.match(botSource, /\$1::uuid IS NULL OR tg\.id = \$1/);
  assert.match(botSource, /\$1::uuid IS NULL OR ci\.group_id = \$1/);
});
