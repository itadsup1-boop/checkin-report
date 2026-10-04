import test from 'node:test';
import assert from 'node:assert/strict';
import { isExcludedSheetEmployee, EXCLUDED_SHEET_NAMES } from './excluded-employees.js';

test('isExcludedSheetEmployee: nhận diện chính xác các tên loại trừ', () => {
    assert.equal(isExcludedSheetEmployee('Boss'), true);
    assert.equal(isExcludedSheetEmployee('boss'), true);
    assert.equal(isExcludedSheetEmployee('  BOSS  '), true);
    assert.equal(isExcludedSheetEmployee('Longg'), true);
    assert.equal(isExcludedSheetEmployee('longg'), true);
    assert.equal(isExcludedSheetEmployee('test'), true);
    assert.equal(isExcludedSheetEmployee('Test'), true);
    assert.equal(isExcludedSheetEmployee('Boss Hỗ Trợ'), true);
    assert.equal(isExcludedSheetEmployee('boss hỗ trợ'), true);
    assert.equal(isExcludedSheetEmployee('tester'), true);

    // Không được loại trừ nhân viên thực tế
    assert.equal(isExcludedSheetEmployee('Nguyễn Hồng Việt'), false);
    assert.equal(isExcludedSheetEmployee('Hoàng Long'), false);
    assert.equal(isExcludedSheetEmployee('Trịnh Khánh Phương'), false);
    assert.equal(isExcludedSheetEmployee('Quỳnh'), false);
    assert.equal(isExcludedSheetEmployee(''), false);
    assert.equal(isExcludedSheetEmployee(null), false);
    assert.equal(isExcludedSheetEmployee(undefined), false);
});
