import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const managementSource = fs.readFileSync(new URL('./TelesaleManagement.jsx', import.meta.url), 'utf8');
const tableSource = fs.readFileSync(new URL('./components/TelesaleMappingTable.jsx', import.meta.url), 'utf8');
const statsSource = fs.readFileSync(new URL('./components/TelesaleStatsCards.jsx', import.meta.url), 'utf8');

test('TelesaleManagement hiển thị đầy đủ tiêu đề, nút hành động và thông tin đối soát điểm danh', () => {
  assert.match(managementSource, /Báo cáo &amp; Đấu nối Telesale/);
  assert.match(managementSource, /Tự động khớp tên/);
  assert.match(managementSource, /Gửi nhắc nhở ngay/);
  assert.match(managementSource, /Làm mới/);
  assert.match(managementSource, /Quy tắc đối soát điểm danh tự động khi Nhắc nhở &amp; Phạt báo cáo Telesale/);
});

test('Bảng đấu nối Telesale có đầy đủ các cột và hỗ trợ chọn tài khoản điểm danh', () => {
  assert.match(tableSource, /Nhân sự Báo Cáo Telesale/);
  assert.match(tableSource, /Tài Khoản Điểm Danh Cá Nhân \(Đấu nối\)/);
  assert.match(tableSource, /Hôm nay có đi làm không\?/);
  assert.match(tableSource, /Báo cáo hôm nay/);
  assert.match(tableSource, /Thao tác/);
  assert.match(tableSource, /-- Chưa đấu nối tài khoản điểm danh --/);
  assert.match(tableSource, /Lưu đấu nối/);
  assert.match(tableSource, /Khớp tên/);
});

test('Bảng đấu nối hiển thị rõ trạng thái đi làm, nghỉ phép/OFF và miễn phạt khi không đi làm', () => {
  assert.match(tableSource, /Đã check-in/);
  assert.match(tableSource, /Lịch ca OFF|Nghỉ phép/);
  assert.match(tableSource, /Chưa check-in/);
  assert.match(tableSource, /Miễn nộp/);
  assert.match(tableSource, /Quá 19:00 sẽ bị phạt 50k/);
});

test('Thẻ thống kê Telesale hiển thị đủ các chỉ số nghiệp vụ', () => {
  assert.match(statsSource, /Tổng nhân sự/);
  assert.match(statsSource, /Đã đấu nối/);
  assert.match(statsSource, /Đi làm hôm nay/);
  assert.match(statsSource, /Nghỉ ca \/ Có phép/);
  assert.match(statsSource, /Đã nộp báo cáo/);
  assert.match(statsSource, /Chưa nộp \(Đi làm\)/);
});

test('TelesaleManagement chứa 3 Tab chuyên biệt: Đấu nối, Cấu hình Form và Thời gian', () => {
  assert.match(managementSource, /Nhân sự &amp; Đấu nối/);
  assert.match(managementSource, /Cấu hình Form &amp; Chỉ số/);
  assert.match(managementSource, /Thời gian &amp; Quét phạt/);
});

test('TelesaleFormBuilderTab và TelesaleScheduleTab tồn tại và có đầy đủ chức năng tùy biến', () => {
  const formBuilderSource = fs.readFileSync(new URL('./components/TelesaleFormBuilderTab.jsx', import.meta.url), 'utf8');
  const scheduleSource = fs.readFileSync(new URL('./components/TelesaleScheduleTab.jsx', import.meta.url), 'utf8');

  assert.match(formBuilderSource, /Cấu hình Danh sách Trường Báo Cáo/);
  assert.match(formBuilderSource, /Thêm trường mới/);
  assert.match(formBuilderSource, /Mốc Khen thưởng \/ Cảnh báo/);
  assert.match(formBuilderSource, /Tính lũy kế cộng dồn cả tháng/);

  assert.match(scheduleSource, /Cài đặt Thời Gian, Quét Phạt &amp; Báo Cáo Tổng/);
  assert.match(scheduleSource, /Bật tin nhắn nhắc nhở nộp báo cáo/);
  assert.match(scheduleSource, /Bật quét phạt nộp muộn tự động/);
  assert.match(scheduleSource, /Bật gửi Báo cáo tổng kết ngày toàn đội/);
  assert.match(scheduleSource, /Đồng bộ Header Google Sheets/);
});

