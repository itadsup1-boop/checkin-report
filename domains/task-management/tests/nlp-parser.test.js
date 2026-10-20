import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNlpMessage } from '../interfaces/telegram/nlp-parser.js';
import { parseDeadlineVi } from '../application/task-service.js';

test('NLU nhận diện các câu giao việc và deadline tiếng Việt', () => {
    assert.deepEqual(parseNlpMessage('Giao NV001 gọi khách lúc 5h chiều'), {
        command: 'giao', codes: ['NV001'], title: 'gọi khách', dueInput: '5h chiều',
        priority: 'NORMAL', reminderMode: 'ONCE_BEFORE_DUE'
    });
    assert.equal(parseNlpMessage('Gửi việc cho em MaiNV003 hoàn thành báo cáo trước 18h nay').codes[0], 'NV003');
    assert.equal(parseNlpMessage('Gửi việc cho em MaiNV003 hoàn thành báo cáo trước 18h nay').title, 'hoàn thành báo cáo');
    const byName = parseNlpMessage('Giao cho Nguyễn Văn An gọi khách lúc 5h chiều');
    assert.deepEqual(byName, {
        command: 'giao', codes: [], title: 'gọi khách', dueInput: '5h chiều',
        assigneeQuery: 'Nguyễn Văn An', sourceText: 'Giao cho Nguyễn Văn An gọi khách lúc 5h chiều',
        priority: 'NORMAL', reminderMode: 'ONCE_BEFORE_DUE'
    });
    const byGroup = parseNlpMessage('Giao trong nhóm Marketing, Nguyễn Văn An kiểm tra dữ liệu lúc 9h mai');
    assert.equal(byGroup.groupQuery, 'Marketing');
    assert.equal(byGroup.assigneeQuery, 'Nguyễn Văn An');
    assert.equal(byGroup.title, 'kiểm tra dữ liệu');
    const employeeBeforeGroup = parseNlpMessage('Giao cho An trong nhóm Marketing gọi khách lúc 5h chiều');
    assert.equal(employeeBeforeGroup.groupQuery, 'Marketing');
    assert.equal(employeeBeforeGroup.assigneeQuery, 'An');
    assert.equal(employeeBeforeGroup.title, 'gọi khách');
    const employeeAtGroup = parseNlpMessage('Giao Long xử lý khách hàng gấp ở nhóm test');
    assert.equal(employeeAtGroup.groupQuery, 'test');
    assert.equal(employeeAtGroup.assigneeQuery, 'Long');
    assert.equal(employeeAtGroup.title, 'xử lý khách hàng gấp');
});

test('NLU nhận diện task, nhắc việc, tin nhắn và Excel', () => {
    assert.equal(parseNlpMessage('Hoàn thành #T-101'), null);
    assert.deepEqual(parseNlpMessage('Việc nào sắp hết hạn'), { command: 'viecsaptoihan' });
    assert.deepEqual(parseNlpMessage('Việc nào quá hạn rồi'), { command: 'viectruhan' });
    assert.deepEqual(parseNlpMessage('Nhắn cho NV001 kiểm tra dữ liệu'), {
        command: 'guitin', codes: ['NV001'], all: false, recipientName: null, content: 'kiểm tra dữ liệu'
    });
    assert.equal(parseNlpMessage('Kêu mọi người họp lúc 9h sáng mai').all, true);
    assert.deepEqual(parseNlpMessage('Lấy công việc ra file Excel'), { command: 'xuatexcel', kind: 'TASKS' });
    assert.equal(parseNlpMessage('Công việc của tôi'), null);
    assert.equal(parseNlpMessage('Tôi nhận việc này'), null);
});

test('parseDeadlineVi tái sử dụng được cách nói 9h mai và 5h chiều', () => {
    const now = new Date('2026-10-19T05:00:00.000Z');
    assert.equal(parseDeadlineVi('5h chiều', now).toISOString(), '2026-10-19T10:00:00.000Z');
    assert.equal(parseDeadlineVi('9h mai', now).toISOString(), '2026-10-20T02:00:00.000Z');
});
