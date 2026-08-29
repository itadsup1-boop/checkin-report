import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./SettingsManagement.jsx', import.meta.url), 'utf8');

test('role lịch khách Tour chỉ hiện Sheet lịch khách, không hiện Sheet chấm công', () => {
  assert.match(
    source,
    /const showCustomerSheet = !role \|\| \['customer', 'report', 'report_tour', 'warehouse'\]\.includes\(role\);/
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
