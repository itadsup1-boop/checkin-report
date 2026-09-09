import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const scheduleHtml = fs.readFileSync(path.join(currentDir, 'public', 'schedule.html'), 'utf8');

test('Mini App dùng ngày hiện tại theo múi giờ Việt Nam', () => {
    assert.match(scheduleHtml, /timeZone:\s*'Asia\/Bangkok'/);
    assert.match(scheduleHtml, /function isPastScheduleDate\(dateStr\)/);
});

test('Chủ nhật mặc định mở tuần sau', () => {
    assert.match(scheduleHtml, /let currentTab = isSundayInVietnam\(\) \? 'next' : 'current';/);
});

test('ngày đã qua bị khóa với nhân viên nhưng Admin vẫn có thể chỉnh', () => {
    assert.match(scheduleHtml, /const isPastDay = !isUserAdmin && isPastScheduleDate\(dateStr\);/);
    assert.match(scheduleHtml, /const dayLocked = forceLocked \|\| isPastDay;/);
    assert.match(scheduleHtml, /if \(!isUserAdmin && isPastScheduleDate\(dateStr\)\) return;/);
});

test('khi lưu chỉ gửi những ngày còn được phép sửa', () => {
    assert.match(scheduleHtml, /function getEditableDays\(days\)/);
    assert.match(scheduleHtml, /const editableDays = getEditableDays\(targetDays\);/);
    assert.match(scheduleHtml, /const daysToSave = editableDays\.map/);
});
