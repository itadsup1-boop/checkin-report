import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
    parseDeadlineVi, parseDeadlineCellValue, vnWallToUtc, vietnamToday, formatVnTime, STATUS_LABEL
} from './task-service.js';

function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;

// Header bắt buộc: MÃ NV | NỘI DUNG | HẠN. Tùy chọn: ƯU TIÊN | NHẮC.
// Mapping cố định (deterministic) — đề xuất mapping bằng AI thuộc P5.
const HEADER_ALIASES = {
    code: ['ma nv', 'ma nhan vien', 'manv', 'employee code', 'employee_code', 'employeecode'],
    title: ['noi dung', 'noi dung cong viec', 'cong viec', 'nhiem vu', 'title', 'task'],
    due: ['han', 'han chot', 'deadline', 'thoi han', 'han nop'],
    priority: ['uu tien', 'priority'],
    daily: ['nhac', 'nhac hang ngay', 'daily', 'remind', 'nhac daily']
};

const REMINDER_LABEL = {
    DAILY_AFTER_CHECKIN: 'Hàng ngày sau check-in',
    ONCE_BEFORE_DUE: 'Trước hạn 30 phút'
};

const FORM_ASSIGNMENT_LABEL = { OPEN: 'Chưa nộp', SUBMITTED: 'Đã nộp', CANCELLED: 'Đã hủy' };

export function normalizeHeader(text) {
    return String(text ?? '').trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/\s+/g, ' ');
}

// Ô Excel nhiều kiểu: công thức lấy kết quả cached (không thực thi — mục 27.3),
// richText nối text, hyperlink lấy text hiển thị.
export function cellValueToText(value) {
    if (value == null) return '';
    if (typeof value !== 'object') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value.richText)) return value.richText.map(rt => rt.text).join('');
    if (value.formula !== undefined) {
        return value.result == null ? '' : (typeof value.result === 'object' ? cellValueToText(value.result) : String(value.result));
    }
    if (value.hyperlink) return String(value.text ?? value.hyperlink);
    if (value.text !== undefined) return String(value.text);
    return String(value);
}

export function validateUploadMeta({ fileName, mimeType, size }) {
    if (!/\.(xlsx|csv)$/i.test(String(fileName || ''))) {
        return 'Chỉ nhận file .xlsx hoặc .csv (không nhận .xlsm có macro).';
    }
    if (mimeType && /vnd\.ms-excel\.sheet\.macroenabled/i.test(String(mimeType))) {
        return 'File chứa macro (.xlsm) bị chặn — lưu lại dạng .xlsx không macro.';
    }
    if (Number(size) > MAX_FILE_BYTES) {
        return `File quá lớn (tối đa ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB).`;
    }
    return null;
}

export function mapTaskHeaders(headers) {
    const colByField = {};
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
        const matches = [];
        headers.forEach((h, index) => {
            if (aliases.includes(normalizeHeader(h))) matches.push(index);
        });
        if (matches.length > 1) {
            return { error: `Cột "${headers[matches[0]]}" xuất hiện ${matches.length} lần — chỉ giữ một cột cho mỗi trường.` };
        }
        if (matches.length === 1) colByField[field] = matches[0];
    }
    const missing = ['code', 'title', 'due'].filter(f => colByField[f] === undefined);
    if (missing.length) {
        const label = { code: 'MÃ NV', title: 'NỘI DUNG', due: 'HẠN' };
        return { error: `Thiếu cột bắt buộc: ${missing.map(m => label[m]).join(', ')}. Header hiện tại: ${headers.filter(Boolean).join(' | ')}` };
    }
    return { colByField };
}

export function parseTaskRow({ rowNo, cells, colByField, now = new Date() }) {
    const code = cellValueToText(cells[colByField.code]).trim().toUpperCase();
    if (!code) return { error: `Dòng ${rowNo}: thiếu MÃ NV.` };
    const title = cellValueToText(cells[colByField.title]).trim();
    if (!title) return { error: `Dòng ${rowNo}: thiếu NỘI DUNG.` };
    const dueRaw = cells[colByField.due];
    const dueAt = parseDeadlineCellValue(dueRaw instanceof Date ? dueRaw : cellValueToText(dueRaw).trim(), now);
    if (!dueAt) return { error: `Dòng ${rowNo}: không đọc được HẠN (dùng HH:MM hoặc DD/MM/YYYY HH:MM).` };

    let priority = 'NORMAL';
    if (colByField.priority !== undefined) {
        const raw = cellValueToText(cells[colByField.priority]).trim().toLowerCase();
        if (raw) {
            const p = raw.replace(/^!/, '');
            if (p === 'cao' || p === 'high') priority = 'HIGH';
            else if (p === 'gap' || p === 'urgent') priority = 'URGENT';
            else if (p === 'thuong' || p === 'normal') priority = 'NORMAL';
            else return { error: `Dòng ${rowNo}: ƯU TIÊN không rõ "${raw}" (dùng cao/gap/thường).` };
        }
    }
    let reminderMode = 'ONCE_BEFORE_DUE';
    if (colByField.daily !== undefined) {
        const raw = cellValueToText(cells[colByField.daily]).trim().toLowerCase();
        if (raw) {
            if (['x', 'co', 'daily', '1', 'true', 'y', 'yes'].includes(raw)) reminderMode = 'DAILY_AFTER_CHECKIN';
            else if (['khong', 'k', '0', 'no', 'false', 'n'].includes(raw)) reminderMode = 'ONCE_BEFORE_DUE';
            else return { error: `Dòng ${rowNo}: NHẮC không rõ "${raw}" (dùng x hoặc không).` };
        }
    }
    return { row: { rowNo, code, title, dueAt, priority, reminderMode } };
}

export async function parseWorkbookBuffer(buffer, fileName) {
    const workbook = new ExcelJS.Workbook();
    if (/\.csv$/i.test(String(fileName))) {
        await workbook.csv.read(Readable.from([buffer]));
    } else {
        await workbook.xlsx.load(buffer);
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return { sheetName: null, headers: [], rows: [] };
    const headers = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
        headers[colNumber - 1] = cellValueToText(cell.value).trim();
    });
    const dataRows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber === 1) return;
        const cells = [];
        for (let c = 1; c <= headers.length; c++) cells[c - 1] = row.getCell(c).value ?? null;
        if (cells.every(v => v == null || cellValueToText(v).trim() === '')) return;
        dataRows.push({ rowNo: rowNumber, cells });
    });
    return { sheetName: sheet.name, headers, rows: dataRows };
}

export function buildDryRunText({ fileName, sheetName, rowsTotal, okRows, errors, conflictCount, maxListed = 10 }) {
    const lines = [
        `📊 KIỂM TRA FILE: ${fileName}${sheetName ? ` (sheet "${sheetName}")` : ''}`,
        `Tổng dòng dữ liệu: ${rowsTotal} | Hợp lệ: ${okRows.length} | Lỗi: ${errors.length} | Trùng việc đang mở: ${conflictCount}`,
        ''
    ];
    if (errors.length) {
        lines.push(`❌ Lỗi (${Math.min(errors.length, maxListed)} dòng đầu):`);
        for (const e of errors.slice(0, maxListed)) lines.push(`• ${e.reason}`);
        if (errors.length > maxListed) lines.push(`… và ${errors.length - maxListed} lỗi khác`);
        lines.push('');
    }
    if (conflictCount) {
        lines.push('⚠️ Trùng nhiệm vụ đang mở (cùng nhân viên + cùng nội dung):');
        for (const r of okRows.filter(x => x.conflict).slice(0, maxListed)) {
            lines.push(`• Dòng ${r.rowNo}: ${r.code} — ${r.title}`);
        }
        lines.push('Import có thể bỏ qua các dòng trùng này, hoặc vẫn tạo đủ.');
        lines.push('');
    }
    if (okRows.length) {
        lines.push('Bấm nút bên dưới để import (mỗi dòng tạo 1 nhiệm vụ như /giao).');
    } else {
        lines.push('Không còn dòng hợp lệ nào — sửa file rồi gửi lại.');
    }
    return lines.join('\n');
}

export async function buildTaskWorkbook(rows) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Nhiệm vụ');
    ws.columns = [
        { header: '#T', key: 'display_code', width: 8 },
        { header: 'Nội dung', key: 'title', width: 40 },
        { header: 'Mã NV', key: 'code', width: 10 },
        { header: 'Nhân viên', key: 'name', width: 24 },
        { header: 'Trạng thái', key: 'status', width: 18 },
        { header: 'Deadline', key: 'due', width: 20 },
        { header: 'Giao lúc', key: 'created', width: 20 },
        { header: 'Ưu tiên', key: 'priority', width: 10 },
        { header: 'Nhắc', key: 'reminder', width: 22 },
        { header: 'Nhận lúc', key: 'accepted', width: 20 },
        { header: 'Hoàn thành lúc', key: 'completed', width: 20 },
        { header: 'Duyệt lúc', key: 'reviewed', width: 20 },
        { header: 'Người duyệt', key: 'reviewedBy', width: 14 },
        { header: 'Ghi chú duyệt', key: 'reviewNote', width: 30 },
        { header: 'Trạng thái nhiệm vụ', key: 'taskStatus', width: 16 }
    ];
    for (const r of rows) {
        ws.addRow({
            display_code: `#T-${r.display_code}`,
            title: r.title,
            code: r.employee_code_snapshot,
            name: r.employee_name_snapshot,
            status: STATUS_LABEL[r.assignment_status] || r.assignment_status,
            due: formatVnTime(r.due_at),
            created: formatVnTime(r.created_at),
            priority: r.priority,
            reminder: REMINDER_LABEL[r.reminder_mode] || r.reminder_mode,
            accepted: r.accepted_at ? formatVnTime(r.accepted_at) : '',
            completed: r.completed_at ? formatVnTime(r.completed_at) : '',
            reviewed: r.reviewed_at ? formatVnTime(r.reviewed_at) : '',
            reviewedBy: r.reviewed_by || '',
            reviewNote: r.review_note || '',
            taskStatus: r.status === 'ACTIVE' ? 'Đang chạy' : 'Đã hủy'
        });
    }
    ws.getRow(1).font = { bold: true };
    return wb.xlsx.writeBuffer();
}

export async function buildFormWorkbook({ template, assignments, submissions }) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Bài nộp');
    const fields = assignments[0]?.fields || template.draft_fields || [];
    ws.columns = [
        { header: '#F', key: 'display_code', width: 8 },
        { header: 'Form', key: 'title', width: 28 },
        { header: 'Mã NV', key: 'code', width: 10 },
        { header: 'Nhân viên', key: 'name', width: 24 },
        { header: 'Hạn nộp', key: 'due', width: 20 },
        { header: 'Trạng thái', key: 'status', width: 12 },
        { header: 'Nộp lúc', key: 'submittedAt', width: 20 },
        { header: 'Trễ', key: 'late', width: 6 },
        { header: 'Điểm', key: 'scores', width: 30 },
        { header: 'Nhận xét', key: 'comment', width: 30 },
        ...fields.map(f => ({ header: f.label, key: `ans_${f.key}`, width: 22 }))
    ];
    const submissionByAssignment = new Map(submissions.map(s => [s.assignment_id, s]));
    for (const a of assignments) {
        const s = submissionByAssignment.get(a.id);
        const row = {
            display_code: `#F-${template.display_code}`,
            title: template.title,
            code: a.employee_code_snapshot,
            name: a.employee_name_snapshot,
            due: formatVnTime(a.due_at),
            status: FORM_ASSIGNMENT_LABEL[a.status] || a.status,
            submittedAt: s ? formatVnTime(s.submitted_at) : '',
            late: s?.is_late ? 'Trễ' : '',
            scores: '',
            comment: ''
        };
        if (s?.evaluation) {
            row.scores = (s.evaluation.criteria || []).map(c => `${c.label}: ${c.score}/5`).join(' | ');
            row.comment = s.evaluation.comment || '';
        }
        for (const f of fields) {
            const value = s?.answers?.[f.key];
            row[`ans_${f.key}`] = Array.isArray(value) ? value.join(', ') : (value ?? '');
        }
        ws.addRow(row);
    }
    ws.getRow(1).font = { bold: true };
    return wb.xlsx.writeBuffer();
}

export function createExcelService({ excelRepository, taskRepository, taskService, formRepository = null, now = () => new Date() }) {
    function checksumBuffer(buffer) {
        return createHash('sha256').update(buffer).digest('hex');
    }

    async function resolveRows(rows) {
        const codes = [...new Set(rows.map(r => r.code))];
        const employees = await taskRepository.findEmployeesByCodes(codes);
        const byCode = new Map(employees.map(e => [String(e.employee_code).toUpperCase(), e]));
        const resolved = [];
        const errors = [];
        for (const row of rows) {
            const employee = byCode.get(row.code);
            if (!employee) {
                errors.push({ rowNo: row.rowNo, reason: `Dòng ${row.rowNo}: không tìm thấy nhân viên ${row.code}.` });
                continue;
            }
            if (!employee.telegram_id) {
                errors.push({ rowNo: row.rowNo, reason: `Dòng ${row.rowNo}: ${row.code} chưa có Telegram ID.` });
                continue;
            }
            resolved.push({
                ...row,
                employee: {
                    employeeId: employee.id, employeeCode: employee.employee_code,
                    employeeName: employee.full_name, telegramUserId: employee.telegram_id
                }
            });
        }
        return { resolved, errors };
    }

    // Conflict theo mục 27.3: hiện cho quản lý chọn, không tự ghi đè — trùng =
    // nhân viên đang có nhiệm vụ MỞ cùng nội dung (so sánh không phân biệt hoa thường).
    async function markConflicts(rows) {
        if (!rows.length) return rows;
        const openTasks = await taskRepository.listOpenTasksByEmployeeIds(rows.map(r => r.employee.employeeId));
        const openByEmployee = new Map();
        for (const t of openTasks) {
            if (!openByEmployee.has(t.employee_id)) openByEmployee.set(t.employee_id, new Set());
            openByEmployee.get(t.employee_id).add(String(t.title).trim().toLowerCase());
        }
        return rows.map(row => ({
            ...row,
            conflict: openByEmployee.get(row.employee.employeeId)?.has(row.title.trim().toLowerCase()) || false
        }));
    }

    async function dryRunTaskImport({ buffer, fileName, managerId }) {
        const checksum = checksumBuffer(buffer);
        const { sheetName, headers, rows: dataRows } = await parseWorkbookBuffer(buffer, fileName);
        if (dataRows.length > MAX_IMPORT_ROWS) {
            fail('TOO_MANY_ROWS', `File có ${dataRows.length} dòng, vượt giới hạn ${MAX_IMPORT_ROWS}.`);
        }
        const mapped = mapTaskHeaders(headers);
        if (mapped.error) fail('HEADER_INVALID', mapped.error);

        const parsed = [];
        const parseErrors = [];
        for (const dataRow of dataRows) {
            const result = parseTaskRow({ rowNo: dataRow.rowNo, cells: dataRow.cells, colByField: mapped.colByField });
            if (result.error) parseErrors.push({ rowNo: dataRow.rowNo, reason: result.error });
            else parsed.push(result.row);
        }
        const { resolved, errors } = await resolveRows(parsed);
        const allErrors = [...parseErrors, ...errors];
        const withConflicts = await markConflicts(resolved);
        const conflictCount = withConflicts.filter(r => r.conflict).length;

        await excelRepository.logExcelSync({
            entity: 'TASK', mode: 'DRY_RUN', fileName, fileChecksum: checksum,
            rowsTotal: dataRows.length, rowsOk: resolved.length,
            rowsError: allErrors.length, rowsConflict: conflictCount,
            mapping: mapped.colByField, rowErrors: allErrors, createdBy: managerId
        });
        return { checksum, fileName, sheetName, rowsTotal: dataRows.length, okRows: withConflicts, errors: allErrors, conflictCount };
    }

    async function commitTaskImport({ checksum, fileName, rows, managerId, includeConflicts = false }) {
        if (!rows.length) fail('NO_ROWS', 'Không có dòng hợp lệ để import.');
        const selected = includeConflicts ? rows : rows.filter(r => !r.conflict);
        if (!selected.length) fail('NO_ROWS', 'Tất cả dòng hợp lệ đều trùng việc đang mở — chọn "Import tất cả" nếu vẫn muốn tạo.');

        let created = 0;
        let skipped = 0;
        const failed = [];
        for (const row of selected) {
            try {
                const result = await taskService.createTask({
                    createdBy: managerId,
                    title: row.title,
                    priority: row.priority,
                    reminderMode: row.reminderMode,
                    dueAt: row.dueAt,
                    assignees: [row.employee],
                    idempotencyKey: `excel:${checksum}:${row.rowNo}`
                });
                if (result.duplicated) skipped += 1;
                else created += 1;
            } catch (error) {
                failed.push({ rowNo: row.rowNo, reason: `Dòng ${row.rowNo}: ${error.message}` });
            }
        }

        await excelRepository.logExcelSync({
            entity: 'TASK', mode: 'COMMIT', fileName, fileChecksum: checksum,
            rowsTotal: rows.length, rowsOk: created, rowsError: failed.length,
            rowsConflict: rows.filter(r => r.conflict).length,
            mapping: null, rowErrors: failed, createdBy: managerId
        });
        return { created, skipped, failed };
    }

    async function exportTasks({ managerId, fromDate = null, toDate = null }) {
        const [ty, tm, td] = vietnamToday(now()).split('-').map(Number);
        const from = fromDate || vnWallToUtc(ty, tm, td, 0, 0);
        const to = toDate || vnWallToUtc(ty, tm, td + 7, 0, 0);
        const rows = await taskRepository.listTasksForExport({ createdBy: managerId, fromDate: from, toDate: to });
        const buffer = await buildTaskWorkbook(rows);
        return { buffer, count: rows.length, from, to };
    }

    async function exportForm({ displayCode, managerId }) {
        if (!formRepository) fail('NOT_AVAILABLE', 'Xuất form cần repository form (chưa cấu hình).');
        const template = await formRepository.findFormTemplateByDisplayCode(displayCode);
        if (!template) fail('FORM_NOT_FOUND', `Không tìm thấy form #F-${displayCode}.`);
        if (String(template.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người tạo form mới xuất được.');
        const assignments = await formRepository.listFormAssignmentsByTemplate(template.id);
        const submissions = await formRepository.listFormSubmissionsByTemplate(template.id);
        const buffer = await buildFormWorkbook({ template, assignments, submissions });
        return { buffer, count: assignments.length };
    }

    return { dryRunTaskImport, commitTaskImport, exportTasks, exportForm };
}
