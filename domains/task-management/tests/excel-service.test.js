import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
    validateUploadMeta, mapTaskHeaders, parseTaskRow, cellValueToText,
    parseWorkbookBuffer, buildDryRunText, buildTaskWorkbook,
    createExcelService, MAX_FILE_BYTES
} from '../application/excel-service.js';
import { parseDeadlineVi, vnWallToUtc, STATUS_LABEL } from '../application/task-service.js';

async function buildTaskFixtureBuffer() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Giao việc');
    ws.addRow(['MÃ NV', 'NỘI DUNG', 'HẠN', 'ƯU TIÊN', 'NHẮC']);
    ws.addRow(['NV001', 'Gọi khách mới', '18:00', 'cao', 'x']);
    ws.addRow(['NV999', 'Việc lạ', '18:00', '', '']);
    ws.addRow(['NV002', 'Báo cáo B', '17:00', '', '']);
    ws.addRow(['nv001', 'Gọi khách A', '18:00', '', '']);
    return wb.xlsx.writeBuffer();
}

function createMocks() {
    const calls = {
        logExcelSync: [], createTask: [], listTasksForExport: [],
        findEmployeesByCodes: [], listOpenTasksByEmployeeIds: []
    };
    const employees = {
        NV001: { id: 'e1', employee_code: 'NV001', full_name: 'Nguyễn Văn A', telegram_id: '111' },
        NV002: { id: 'e2', employee_code: 'NV002', full_name: 'Trần B', telegram_id: null }
    };
    const taskRepository = {
        async findEmployeesByCodes(codes) {
            calls.findEmployeesByCodes.push(codes);
            return codes.map(c => employees[c]).filter(Boolean);
        },
        async listOpenTasksByEmployeeIds(ids) {
            calls.listOpenTasksByEmployeeIds.push(ids);
            return [{ id: 't9', title: 'Gọi khách A', employee_id: 'e1' }];
        },
        async listTasksForExport(input) { calls.listTasksForExport.push(input); return []; }
    };
    const excelRepository = {
        async logExcelSync(input) { calls.logExcelSync.push(input); return 1; }
    };
    const taskService = {
        async createTask(input) {
            calls.createTask.push(input);
            if (input.title === 'Nhiệm vụ lỗi') throw new Error('Deadline đã qua, hãy chọn thời gian tương lai.');
            return { duplicated: input.title === 'Nhiệm vụ trùng', task: { display_code: 105 } };
        }
    };
    const formRepository = {
        async findFormTemplateByDisplayCode(code) {
            if (code === '999') return null;
            return {
                id: 500, display_code: code, title: 'Báo cáo tuần',
                created_by: '888', draft_fields: []
            };
        },
        async listFormAssignmentsByTemplate() {
            return [{
                id: 1, employee_code_snapshot: 'NV001', employee_name_snapshot: 'Nguyễn Văn A',
                status: 'SUBMITTED', due_at: new Date('2026-10-19T10:00:00+07:00'),
                fields: [{ key: 'doanh_so', label: 'Doanh số', type: 'money' }]
            }];
        },
        async listFormSubmissionsByTemplate() {
            return [{
                assignment_id: 1, submitted_at: new Date('2026-10-19T11:00:00+07:00'), is_late: true,
                answers: { doanh_so: 1250000 },
                evaluation: { criteria: [{ label: 'Đầy đủ', score: 4 }], comment: 'Ổn' }
            }];
        }
    };
    return { calls, taskRepository, excelRepository, taskService, formRepository };
}

function createService(mocks, formRepository = null) {
    return createExcelService({
        excelRepository: mocks.excelRepository,
        taskRepository: mocks.taskRepository,
        taskService: mocks.taskService,
        formRepository,
        now: () => new Date('2026-10-19T10:00:00+07:00')
    });
}

test('validateUploadMeta: chặn .xlsm, macro MIME, file quá lớn; nhận .xlsx/.csv', () => {
    assert.match(validateUploadMeta({ fileName: 'a.xlsm', size: 100 }), /\.xlsm/);
    assert.match(validateUploadMeta({ fileName: 'a.xlsx', mimeType: 'application/vnd.ms-excel.sheet.macroenabled.12', size: 100 }), /macro/);
    assert.match(validateUploadMeta({ fileName: 'a.xlsx', size: MAX_FILE_BYTES + 1 }), /quá lớn/);
    assert.match(validateUploadMeta({ fileName: 'a.pdf', size: 100 }), /Chỉ nhận/);
    assert.equal(validateUploadMeta({ fileName: 'giao viec.xlsx', size: 100 }), null);
    assert.equal(validateUploadMeta({ fileName: 'giao viec.CSV', size: 100 }), null);
});

test('mapTaskHeaders: nhận header tiếng Việt có dấu; thiếu cột/cột lặp báo lỗi rõ', () => {
    const ok = mapTaskHeaders(['MÃ NV', 'NỘI DUNG', 'Hạn', 'Ưu tiên', 'NHẮC']);
    assert.deepEqual(ok.colByField, { code: 0, title: 1, due: 2, priority: 3, daily: 4 });

    const missing = mapTaskHeaders(['MÃ NV', 'Ghi chú']);
    assert.match(missing.error, /NỘI DUNG, HẠN/);
    assert.match(missing.error, /MÃ NV \| Ghi chú/);

    assert.match(mapTaskHeaders(['MÃ NV', 'MÃ NHÂN VIÊN', 'NỘI DUNG', 'HẠN']).error, /xuất hiện 2 lần/);
});

test('parseTaskRow: đọc đủ trường, deadline là ô Date Excel đọc theo giờ tường mục VN', () => {
    const colByField = { code: 0, title: 1, due: 2, priority: 3, daily: 4 };
    const parsed = parseTaskRow({
        rowNo: 2, colByField,
        cells: ['NV001', 'Gọi khách A', '18:00', '!cao', 'x'],
        now: new Date('2026-10-19T10:00:00+07:00')
    });
    assert.equal(parsed.row.code, 'NV001');
    assert.equal(parsed.row.title, 'Gọi khách A');
    assert.equal(parsed.row.priority, 'HIGH');
    assert.equal(parsed.row.reminderMode, 'DAILY_AFTER_CHECKIN');
    assert.equal(parsed.row.dueAt.toISOString(), parseDeadlineVi('18:00', new Date('2026-10-19T10:00:00+07:00')).toISOString());

    const dateCell = new Date(Date.UTC(2026, 9, 25, 9, 30));
    const fromCell = parseTaskRow({ rowNo: 3, colByField, cells: ['NV001', 'X', dateCell, '', ''] });
    assert.equal(fromCell.row.dueAt.toISOString(), vnWallToUtc(2026, 10, 25, 9, 30).toISOString());

    assert.match(parseTaskRow({ rowNo: 4, colByField, cells: ['', 'X', '18:00', '', ''] }).error, /thiếu MÃ NV/);
    assert.match(parseTaskRow({ rowNo: 5, colByField, cells: ['NV001', '', '18:00', '', ''] }).error, /thiếu NỘI DUNG/);
    assert.match(parseTaskRow({ rowNo: 6, colByField, cells: ['NV001', 'X', 'abc', '', ''] }).error, /không đọc được HẠN/);
    assert.match(parseTaskRow({ rowNo: 7, colByField, cells: ['NV001', 'X', '18:00', 'gấp gáp', ''] }).error, /ƯU TIÊN không rõ/);
    assert.match(parseTaskRow({ rowNo: 8, colByField, cells: ['NV001', 'X', '18:00', '', 'đôi khi'] }).error, /NHẮC không rõ/);
});

test('cellValueToText: công thức lấy kết quả cached, richText nối, hyperlink lấy text', () => {
    assert.equal(cellValueToText({ formula: 'A1+B1', result: 1250000 }), '1250000');
    assert.equal(cellValueToText({ formula: 'NA()' }), '');
    assert.equal(cellValueToText({ richText: [{ text: 'Gọi ' }, { text: 'khách' }] }), 'Gọi khách');
    assert.equal(cellValueToText({ hyperlink: 'https://x.y', text: 'Link' }), 'Link');
    assert.equal(cellValueToText(null), '');
});

test('parseWorkbookBuffer: đọc .xlsx và .csv lấy header + dòng dữ liệu, bỏ dòng trống', async () => {
    const xlsx = await buildTaskFixtureBuffer();
    const parsedXlsx = await parseWorkbookBuffer(xlsx, 'giao.xlsx');
    assert.equal(parsedXlsx.sheetName, 'Giao việc');
    assert.deepEqual(parsedXlsx.headers, ['MÃ NV', 'NỘI DUNG', 'HẠN', 'ƯU TIÊN', 'NHẮC']);
    assert.equal(parsedXlsx.rows.length, 4);
    assert.equal(parsedXlsx.rows[0].rowNo, 2);

    const csv = Buffer.from('MÃ NV,NỘI DUNG,HẠN\nNV001,Gọi khách,18:00\n\n', 'utf8');
    const parsedCsv = await parseWorkbookBuffer(csv, 'giao.csv');
    assert.deepEqual(parsedCsv.headers, ['MÃ NV', 'NỘI DUNG', 'HẠN']);
    assert.equal(parsedCsv.rows.length, 1);
});

test('dryRunTaskImport: tách hợp lệ/lỗi/conflict, ghi log DRY_RUN đủ số liệu', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const buffer = await buildTaskFixtureBuffer();

    const result = await service.dryRunTaskImport({ buffer, fileName: 'giao.xlsx', managerId: '888' });

    assert.equal(result.rowsTotal, 4);
    assert.equal(result.okRows.length, 2);
    assert.equal(result.errors.length, 2);
    assert.deepEqual(result.errors.map(e => e.reason.match(/NV\d+/)[0]).sort(), ['NV002', 'NV999']);
    assert.deepEqual(result.okRows.map(r => r.conflict), [false, true]);
    assert.equal(result.conflictCount, 1);
    assert.match(result.checksum, /^[0-9a-f]{64}$/);

    const log = mocks.calls.logExcelSync[0];
    assert.equal(log.mode, 'DRY_RUN');
    assert.equal(log.entity, 'TASK');
    assert.equal(log.rowsTotal, 4);
    assert.equal(log.rowsOk, 2);
    assert.equal(log.rowsError, 2);
    assert.equal(log.rowsConflict, 1);
    assert.equal(log.createdBy, '888');
});

test('commitTaskImport: bỏ qua dòng conflict mặc định, idempotencyKey theo checksum+dòng, log COMMIT', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const buffer = await buildTaskFixtureBuffer();
    const dryRun = await service.dryRunTaskImport({ buffer, fileName: 'giao.xlsx', managerId: '888' });

    const result = await service.commitTaskImport({
        checksum: dryRun.checksum, fileName: 'giao.xlsx',
        rows: dryRun.okRows, managerId: '888', includeConflicts: false
    });
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.failed.length, 0);
    const task = mocks.calls.createTask[0];
    assert.equal(task.idempotencyKey, `excel:${dryRun.checksum}:2`);
    assert.deepEqual(task.assignees, [{
        employeeId: 'e1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn A', telegramUserId: '111'
    }]);
    assert.equal(mocks.calls.logExcelSync.at(-1).mode, 'COMMIT');
});

test('commitTaskImport: includeConflicts tạo cả dòng trùng; dòng trùng lặp bị đếm skipped; lỗi hứng từng dòng', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const rows = [
        { rowNo: 2, code: 'NV001', title: 'Nhiệm vụ trùng', dueAt: new Date('2026-10-20T10:00:00+07:00'), priority: 'NORMAL', reminderMode: 'ONCE_BEFORE_DUE', conflict: false, employee: { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'A', telegramUserId: '111' } },
        { rowNo: 3, code: 'NV001', title: 'Nhiệm vụ lỗi', dueAt: new Date('2026-10-19T01:00:00+07:00'), priority: 'NORMAL', reminderMode: 'ONCE_BEFORE_DUE', conflict: false, employee: { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'A', telegramUserId: '111' } },
        { rowNo: 4, code: 'NV001', title: 'Việc đang mở', dueAt: new Date('2026-10-20T10:00:00+07:00'), priority: 'NORMAL', reminderMode: 'ONCE_BEFORE_DUE', conflict: true, employee: { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'A', telegramUserId: '111' } }
    ];
    const result = await service.commitTaskImport({
        checksum: 'abc', fileName: 'f.xlsx', rows, managerId: '888', includeConflicts: true
    });
    assert.equal(result.created, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].reason, /Dòng 3: Deadline đã qua/);
    assert.equal(mocks.calls.logExcelSync.at(-1).rowsError, 1);
});

test('commitTaskImport: tất cả đều conflict mà không chọn import tất cả bị từ chối', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const rows = [{
        rowNo: 2, code: 'NV001', title: 'Việc đang mở', dueAt: new Date(), priority: 'NORMAL',
        reminderMode: 'ONCE_BEFORE_DUE', conflict: true,
        employee: { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'A', telegramUserId: '111' }
    }];
    await assert.rejects(
        service.commitTaskImport({ checksum: 'abc', fileName: 'f.xlsx', rows, managerId: '888', includeConflicts: false }),
        /chọn "Import tất cả"/
    );
});

test('exportTasks: mặc định lấy từ 00:00 hôm nay đến 00:00 sau 7 ngày giờ VN', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const result = await service.exportTasks({ managerId: '888' });

    assert.equal(result.count, 0);
    assert.ok(Buffer.isBuffer(Buffer.from(result.buffer)));
    const call = mocks.calls.listTasksForExport[0];
    assert.equal(call.createdBy, '888');
    assert.equal(call.fromDate.toISOString(), '2026-10-18T17:00:00.000Z');
    assert.equal(call.toDate.toISOString(), '2026-10-25T17:00:00.000Z');
});

test('exportForm: chỉ người tạo xuất được; file chứa cột câu hỏi động và điểm rubric', async () => {
    const mocks = createMocks();
    const service = createService(mocks, mocks.formRepository);

    const missing = createService(mocks, mocks.formRepository);
    await assert.rejects(missing.exportForm({ displayCode: '999', managerId: '888' }), /Không tìm thấy form/);
    await assert.rejects(service.exportForm({ displayCode: '101', managerId: '777' }), /Chỉ người tạo form/);

    const result = await service.exportForm({ displayCode: '101', managerId: '888' });
    assert.equal(result.count, 1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(result.buffer);
    const ws = wb.worksheets[0];
    const header = ws.getRow(1).values;
    assert.ok(header.includes('Doanh số'));
    const first = ws.getRow(2);
    assert.equal(first.getCell(1).value, '#F-101');
    assert.equal(first.getCell(8).value, 'Trễ');
    assert.match(first.getCell(9).value, /Đầy đủ: 4\/5/);
    assert.equal(first.getCell(11).value, 1250000);
});

test('buildTaskWorkbook: header in đậm, dòng map đúng nhãn trạng thái và thời gian VN', async () => {
    const buffer = await buildTaskWorkbook([{
        id: 1, display_code: 105, title: 'Gọi khách A', priority: 'HIGH',
        reminder_mode: 'DAILY_AFTER_CHECKIN', due_at: new Date('2026-10-19T18:00:00+07:00'),
        created_at: new Date('2026-10-19T09:00:00+07:00'), status: 'ACTIVE',
        employee_code_snapshot: 'NV001', employee_name_snapshot: 'Nguyễn Văn A',
        assignment_status: 'DONE_PENDING_REVIEW', accepted_at: null, completed_at: null,
        reviewed_at: null, reviewed_by: null, review_note: null
    }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    assert.equal(ws.name, 'Nhiệm vụ');
    assert.ok(ws.getRow(1).font.bold);
    assert.equal(ws.getRow(1).getCell(1).value, '#T');
    const row = ws.getRow(2);
    assert.equal(row.getCell(1).value, '#T-105');
    assert.equal(row.getCell(5).value, STATUS_LABEL.DONE_PENDING_REVIEW);
    assert.match(row.getCell(6).value, /19\/10\/2026/);
    assert.equal(row.getCell(9).value, 'Hàng ngày sau check-in');
});

test('buildDryRunText: hiện số đếm, lỗi từng dòng và cảnh báo conflict', () => {
    const text = buildDryRunText({
        fileName: 'giao.xlsx', sheetName: 'Giao việc', rowsTotal: 4,
        okRows: [{ rowNo: 5, code: 'NV001', title: 'Gọi khách A', conflict: true }],
        errors: [{ rowNo: 3, reason: 'Dòng 3: không tìm thấy nhân viên NV999.' }],
        conflictCount: 1
    });
    assert.match(text, /giao\.xlsx.*sheet "Giao việc"/s);
    assert.match(text, /Tổng dòng dữ liệu: 4 \| Hợp lệ: 1 \| Lỗi: 1 \| Trùng việc đang mở: 1/);
    assert.match(text, /không tìm thấy nhân viên NV999/);
    assert.match(text, /Dòng 5: NV001 — Gọi khách A/);
    assert.match(text, /Import có thể bỏ qua/);
});
