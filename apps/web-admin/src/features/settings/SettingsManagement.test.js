import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./SettingsManagement.jsx', import.meta.url), 'utf8');

test('role lịch khách Tour chỉ hiện Sheet lịch khách, không hiện Sheet chấm công', () => {
  assert.match(
    source,
    /const showCustomerSheet = !role \|\| \['customer', 'report', 'report_tour', 'warehouse', 'retail_checkin', 'telesale'\]\.includes\(role\);/
  );
  assert.match(
    source,
    /const showKpiSheet = !role \|\| \['timekeep', 'report'\]\.includes\(role\);/
  );
  assert.doesNotMatch(
    source,
    /const showKpiSheet =[^;]*report_tour/
  );
});

test('cấu hình nhóm có khu vực chính sách phê duyệt và nút chuyển đổi', () => {
  assert.match(source, /Chính sách phê duyệt của nhóm/);
  assert.match(source, /Tự động duyệt/);
  assert.match(source, /Yêu cầu duyệt/);
  assert.match(source, /toggleApproval/);
  assert.match(source, /approval_settings/);
  assert.match(source, /staff_registration/);
  assert.match(source, /leave_late/);
  assert.match(source, /leave_absence/);
  assert.match(source, /warehouse_order/);
  assert.match(source, /tour_report/);
});

