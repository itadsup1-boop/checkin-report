import { vietnamToday, formatVnTime } from './task-service.js';
import { FETCH_WINDOW } from './rule-config-service.js';

function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}

export const FIELD_TYPES = {
    text: 'Chuỗi', textarea: 'Đoạn văn', number: 'Số', money: 'Tiền',
    percent: 'Phần trăm', date: 'Ngày', single_choice: 'Chọn 1',
    multi_choice: 'Chọn nhiều', link: 'Link'
};

const NUMERIC_TYPES = ['number', 'money', 'percent'];
const OVERDUE_MANAGER_HOURS = 2;
const DUE_SOON_HOURS = 24;

export function isValidFieldType(type) {
    return Object.prototype.hasOwnProperty.call(FIELD_TYPES, type);
}

// Đổi nhãn tiếng Việt do quản lý gõ sang type chuẩn: "tiền" -> money...
export function normalizeFieldType(input) {
    const map = {
        'chuỗi': 'text', 'chui': 'text', 'text': 'text',
        'đoạn': 'textarea', 'doan': 'textarea', 'textarea': 'textarea',
        'số': 'number', 'so': 'number', 'number': 'number',
        'tiền': 'money', 'tien': 'money', 'money': 'money',
        'phần trăm': 'percent', 'phan tram': 'percent', 'percent': 'percent', '%': 'percent',
        'ngày': 'date', 'ngay': 'date', 'date': 'date',
        'chọn': 'single_choice', 'chon': 'single_choice', 'single_choice': 'single_choice',
        'nhiều': 'multi_choice', 'nhieu': 'multi_choice', 'multi_choice': 'multi_choice',
        'link': 'link'
    };
    return map[String(input).trim().toLowerCase()] || null;
}

function makeFieldKey(label, existingKeys) {
    const base = String(label).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
    let key = base;
    let i = 2;
    while (existingKeys.has(key)) key = `${base}_${i++}`;
    return key;
}

// "Doanh số | tiền | bắt buộc | gợi ý: A,B" -> field hoặc lỗi
export function parseFieldLine(line, existingKeys = new Set()) {
    const parts = String(line).split('|').map(p => p.trim());
    if (!parts[0]) return { error: 'Thiếu nhãn trường.' };
    if (parts.length < 2) {
        return { error: 'Thiếu kiểu trường. Ví dụ: Doanh số | tiền | bắt buộc' };
    }
    const type = normalizeFieldType(parts[1]);
    if (!type) return { error: `Kiểu không rõ: "${parts[1]}". Dùng: ${Object.keys(FIELD_TYPES).join(', ')}` };
    const flags = parts.slice(2);
    const field = {
        key: makeFieldKey(parts[0], existingKeys),
        label: parts[0],
        type,
        required: flags.some(f => {
            const l = f.toLowerCase();
            return l.includes('bắt buộc') || l.includes('bat buoc') || l.trim() === '*';
        })
    };
    const optionsToken = flags.find(f => /^(gợi ý|goi y|options)\s*:/i.test(f.trim()));
    if (['single_choice', 'multi_choice'].includes(type)) {
        if (!optionsToken) return { error: `Trường chọn cần options. Ví dụ: Kênh bán | chọn | gợi ý: Online, Cửa hàng` };
        field.options = optionsToken.split(':').slice(1).join(':')
            .split(',').map(o => o.trim()).filter(Boolean);
        if (!field.options.length) return { error: 'Danh sách options trống.' };
    }
    return { field };
}

// Trả về { value } hợp lệ hoặc { error }. value chuẩn hóa để lưu JSON.
export function validateAnswer(field, raw) {
    const text = String(raw ?? '').trim();
    if (!text || text === '-') {
        if (field.required) return { error: `Trường "${field.label}" bắt buộc.` };
        return { value: null };
    }
    switch (field.type) {
        case 'text':
        case 'textarea':
            return { value: text };
        case 'number':
        case 'money': {
            const cleaned = text.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(/,(?=\d{3}\b)/g, '');
            const n = Number(cleaned.replace(',', '.'));
            if (!Number.isFinite(n)) return { error: `"${field.label}" cần số hợp lệ (ví dụ 1250000).` };
            return { value: n };
        }
        case 'percent': {
            const n = Number(text.replace('%', '').replace(',', '.').trim());
            if (!Number.isFinite(n) || n < 0 || n > 100) return { error: `"${field.label}" cần phần trăm 0–100.` };
            return { value: n };
        }
        case 'date': {
            const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(text);
            if (!m) return { error: `"${field.label}" cần ngày DD/MM hoặc DD/MM/YYYY.` };
            const day = Number(m[1]); const month = Number(m[2]); const year = m[3] ? Number(m[3]) : new Date().getFullYear();
            const date = new Date(Date.UTC(year, month - 1, day));
            if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
                return { error: `"${field.label}" không phải ngày hợp lệ.` };
            }
            return { value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` };
        }
        case 'single_choice':
            if (!field.options.includes(text)) return { error: `"${field.label}" chỉ nhận: ${field.options.join(', ')}.` };
            return { value: text };
        case 'multi_choice': {
            const chosen = text.split(',').map(o => o.trim()).filter(Boolean);
            if (!chosen.length) return { error: `"${field.label}" cần ít nhất một lựa chọn.` };
            for (const choice of chosen) {
                if (!field.options.includes(choice)) return { error: `"${field.label}" chỉ nhận: ${field.options.join(', ')}.` };
            }
            return { value: chosen };
        }
        case 'link':
            if (!/^https?:\/\/\S+$/i.test(text)) return { error: `"${field.label}" cần link bắt đầu bằng http(s)://` };
            return { value: text };
        default:
            return { value: text };
    }
}

function formatNumber(n) {
    return Number(n).toLocaleString('vi-VN');
}

export function buildFormMessage({ template, dueAt }) {
    const lines = [
        `📝 FORM #F-${template.display_code} — ${template.title}`
    ];
    if (template.description) lines.push(template.description);
    lines.push(`⏰ Hạn nộp: ${formatVnTime(dueAt)}`, '', 'Nhấn 📝 Điền form để trả lời từng câu.');
    return lines.join('\n');
}

export function buildAggregateText({ template, versionFields, assignments, submissions, now = new Date() }) {
    const open = assignments.filter(a => a.status === 'OPEN');
    const submitted = assignments.filter(a => a.status === 'SUBMITTED');
    const cancelled = assignments.filter(a => a.status === 'CANCELLED');
    const late = submissions.filter(s => s.is_late);

    const lines = [
        `📊 TỔNG HỢP #F-${template.display_code} — ${template.title}`,
        `👥 Phải nộp: ${assignments.length - cancelled.length} | Đã nộp: ${submitted.length} (trễ ${late.length}) | Thiếu: ${open.length}`,
    ];
    if (open.length) {
        lines.push(`Thiếu: ${open.map(a => `${a.employee_code_snapshot} — ${a.employee_name_snapshot}`).join(', ')}`);
    }

    const submissionById = new Map(submissions.map(s => [s.assignment_id, s]));
    for (const field of versionFields) {
        if (NUMERIC_TYPES.includes(field.type)) {
            const values = submitted
                .map(a => ({ a, s: submissionById.get(a.id) }))
                .filter(x => x.s && Number.isFinite(Number(x.s.answers?.[field.key])))
                .map(x => ({ ...x, n: Number(x.s.answers[field.key]) }));
            if (!values.length) continue;
            const sum = values.reduce((acc, x) => acc + x.n, 0);
            lines.push('', `${field.label}: tổng ${formatNumber(sum)} | trung bình ${formatNumber(sum / values.length)}`);
            for (const x of values) {
                const src = x.s.is_late ? ' [trễ]' : '';
                lines.push(`• ${x.a.employee_code_snapshot} (submission #${x.s.id}${src}): ${formatNumber(x.n)}`);
            }
        } else if (field.type === 'text' || field.type === 'textarea') {
            const answers = submitted
                .map(a => ({ a, s: submissionById.get(a.id) }))
                .filter(x => x.s && x.s.answers?.[field.key])
                .map(x => `• ${x.a.employee_code_snapshot} (#${x.s.id}): ${String(x.s.answers[field.key]).slice(0, 80)}`);
            if (answers.length) {
                lines.push('', `${field.label}:`);
                lines.push(...answers);
            }
        }
    }
    lines.push('', `Kỳ tổng hợp: ${formatVnTime(now)}`);
    return lines.join('\n');
}

export function createFormService({ formRepository, taskRepository, ruleConfigService = null, now = () => new Date() }) {
    async function loadTemplateByDisplayCode(displayCode) {
        const template = await formRepository.findFormTemplateByDisplayCode(displayCode);
        if (!template) fail('FORM_NOT_FOUND', `Không tìm thấy form #F-${displayCode}.`);
        return template;
    }

    async function createFormDraft({ createdBy, title, description = null, rubric = [], fields = [] }) {
        if (!title || !String(title).trim()) fail('TITLE_REQUIRED', 'Thiếu tiêu đề form.');
        if (!fields.length) fail('NO_FIELDS', 'Form cần ít nhất một trường câu hỏi.');
        return formRepository.createFormTemplate({
            title: String(title).trim(), description,
            rubric: rubric.map(r => String(r).trim()).filter(Boolean),
            fields, createdBy: String(createdBy)
        });
    }

    async function publishForm({ displayCode, managerId }) {
        const template = await loadTemplateByDisplayCode(displayCode);
        if (String(template.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người tạo form mới phát hành được.');
        if (template.status === 'ARCHIVED') fail('WRONG_STATE', 'Form đã lưu trữ.');
        const fields = template.draft_fields || [];
        if (!fields.length) fail('NO_FIELDS', 'Form chưa có trường câu hỏi nào.');
        const { version } = await formRepository.addFormVersion({
            templateId: template.id, fields, publishedBy: String(managerId)
        });
        return { template, version };
    }

    async function assignForm({ displayCode, managerId, employees, dueAt }) {
        const template = await loadTemplateByDisplayCode(displayCode);
        if (String(template.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người tạo form mới gán được.');
        if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) fail('DUE_INVALID', 'Hạn nộp không hợp lệ.');
        if (dueAt.getTime() <= now().getTime()) fail('DUE_IN_PAST', 'Hạn nộp đã qua.');
        if (!employees.length) fail('NO_ASSIGNEE', 'Không có người nhận hợp lệ nào.');

        // Chưa phát hành thì phát hành luôn (mục 25.3: bản nháp phải được xem
        // trước — wizard đã hiển thị preview cho người tạo trước khi lưu).
        let version;
        if (template.status === 'DRAFT') {
            ({ version } = await publishForm({ displayCode, managerId }));
        } else {
            version = await formRepository.findLatestFormVersion(template.id);
        }

        const { created, skipped } = await formRepository.createFormAssignments({
            templateId: template.id, versionId: version.id,
            employees, dueAt, createdBy: String(managerId)
        });
        for (const assignment of created) {
            await taskRepository.enqueueOutbox({
                deduplicationKey: `formmsg:${assignment.id}`,
                chatId: assignment.telegram_user_id_snapshot,
                text: buildFormMessage({ template, dueAt }),
                replyMarkup: { inline_keyboard: [[
                    { text: '📝 Điền form', callback_data: `report:fill:${assignment.id}` }
                ]] },
                linkMeta: {
                    taskId: template.id, assignmentId: assignment.id,
                    direction: 'FORM_FILL', chatId: assignment.telegram_user_id_snapshot
                }
            });
        }
        return { template, version, created, skipped };
    }

    async function loadFillableAssignment(assignmentId, telegramUserId) {
        const assignment = await formRepository.findFormAssignmentById(assignmentId);
        if (!assignment) fail('ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài gán form này.');
        if (String(assignment.telegram_user_id_snapshot) !== String(telegramUserId)) {
            fail('NOT_ASSIGNEE', 'Form này không gán cho bạn.');
        }
        if (assignment.status !== 'OPEN') fail('WRONG_STATE', 'Form này đã được xử lý.');
        if (assignment.template_status !== 'PUBLISHED') fail('WRONG_STATE', 'Form chưa được phát hành.');
        return assignment;
    }

    async function loadEvaluableAssignment(assignmentId, managerId) {
        const assignment = await formRepository.findFormAssignmentById(assignmentId);
        if (!assignment) fail('ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài gán form này.');
        if (String(assignment.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người tạo form mới đánh giá được.');
        if (!(assignment.rubric || []).length) {
            fail('NO_RUBRIC', 'Form này chưa có rubric — thêm tiêu chí khi tạo form.');
        }
        return assignment;
    }

    async function submitForm({ assignmentId, telegramUserId, answers }) {
        const assignment = await loadFillableAssignment(assignmentId, telegramUserId);
        const existing = await formRepository.findFormSubmissionByAssignment(assignmentId);
        if (existing) fail('WRONG_STATE', 'Bạn đã nộp form này rồi.');
        if (!answers || typeof answers !== 'object') fail('ANSWERS_REQUIRED', 'Thiếu câu trả lời.');

        // Chỉ nhận key có trong form,validate từng kiểu trường
        const validated = {};
        for (const field of assignment.fields || []) {
            const result = validateAnswer(field, answers[field.key]);
            if (result.error) fail('ANSWER_INVALID', result.error);
            validated[field.key] = result.value;
        }

        const isLate = now().getTime() > new Date(assignment.due_at).getTime();
        const submission = await formRepository.createFormSubmission({
            assignmentId, versionId: assignment.version_id, answers: validated, isLate
        });
        await formRepository.markFormAssignmentSubmitted(assignmentId);

        await taskRepository.enqueueOutbox({
            deduplicationKey: `fsub:${submission.id}`,
            chatId: assignment.created_by,
            text: [
                `📥 #F-${assignment.display_code} — ${assignment.employee_name_snapshot} đã nộp form${isLate ? ' (TRẺ hạn)' : ''}.`,
                `Nộp lúc: ${formatVnTime(now())} | Hạn: ${formatVnTime(assignment.due_at)}`
            ].join('\n'),
            replyMarkup: { inline_keyboard: [[
                { text: '⭐ Đánh giá', callback_data: `report:eval:${assignmentId}` }
            ]] },
            linkMeta: {
                taskId: assignment.template_id, assignmentId,
                direction: 'FORM_EVAL', chatId: assignment.created_by
            }
        });
        return { submission, assignment, isLate };
    }

    async function remindDueSoonForms() {
        const rows = await formRepository.findFormAssignmentsDueSoon(
            ruleConfigService ? FETCH_WINDOW.hoursMax : DUE_SOON_HOURS);
        const today = vietnamToday(now());
        const nowMs = now().getTime();
        const configs = ruleConfigService
            ? await ruleConfigService.loadConfigsForTick(rows.map(r => r.created_by))
            : null;
        let sent = 0;
        for (const row of rows) {
            const config = configs?.get(String(row.created_by));
            if (configs && ruleConfigService.shouldSkip(config)) continue;
            if (configs && !ruleConfigService.isFormDueSoonWithin(config, row.due_at, nowMs)) continue;
            await taskRepository.enqueueOutbox({
                deduplicationKey: `fna:${row.id}:${today}`,
                chatId: row.telegram_user_id_snapshot,
                text: `⏰ Form #F-${row.display_code} — ${row.title} đến hạn ${formatVnTime(row.due_at)}, bạn chưa nộp.`,
                replyMarkup: { inline_keyboard: [[
                    { text: '📝 Điền form', callback_data: `report:fill:${row.id}` }
                ]] }
            });
            await formRepository.markFormReminded(row.id, today);
            sent += 1;
        }
        return sent;
    }

    async function remindOverdueForms() {
        const rows = await formRepository.findFormAssignmentsOverdue();
        const today = vietnamToday(now());
        const nowMs = now().getTime();
        const configs = ruleConfigService
            ? await ruleConfigService.loadConfigsForTick(rows.map(r => r.created_by))
            : null;
        let employeeCount = 0;
        let managerCount = 0;
        for (const row of rows) {
            const config = configs?.get(String(row.created_by));
            if (configs && ruleConfigService.shouldSkip(config)) continue;
            const managerHours = config ? config.form_overdue_manager_hours : OVERDUE_MANAGER_HOURS;
            // Query quá hạn trả cả dòng đã nhắc hôm nay — nhắc nhân viên chỉ 1 lần/ngày
            const lastReminderDay = row.last_reminded_on
                ? new Date(row.last_reminded_on).toISOString().slice(0, 10) : null;
            if (lastReminderDay !== today) {
                await taskRepository.enqueueOutbox({
                    deduplicationKey: `fod:${row.id}:${today}`,
                    chatId: row.telegram_user_id_snapshot,
                    text: `🔴 Form #F-${row.display_code} — ${row.title} đã quá hạn (${formatVnTime(row.due_at)}). Vui lòng nộp sớm nhất.`,
                    replyMarkup: { inline_keyboard: [[
                        { text: '📝 Điền form', callback_data: `report:fill:${row.id}` }
                    ]] }
                });
                await formRepository.markFormReminded(row.id, today);
                employeeCount += 1;
            }

            if (!row.overdue_manager_notified_at &&
                nowMs - new Date(row.due_at).getTime() >= managerHours * 3600 * 1000) {
                await taskRepository.enqueueOutbox({
                    deduplicationKey: `fodm:${row.id}`,
                    chatId: row.created_by,
                    text: `🔴 #F-${row.display_code} — ${row.employee_name_snapshot} chưa nộp form (quá hạn ${managerHours} giờ).`
                });
                await formRepository.markFormOverdueManagerNotified(row.id);
                managerCount += 1;
            }
        }
        return { employeeCount, managerCount };
    }

    async function aggregateForm({ displayCode, managerId }) {
        const template = await loadTemplateByDisplayCode(displayCode);
        if (String(template.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người tạo form mới tổng hợp được.');
        const assignments = await formRepository.listFormAssignmentsByTemplate(template.id);
        const submissions = await formRepository.listFormSubmissionsByTemplate(template.id);
        const versionFields = assignments[0]?.fields || template.draft_fields || [];
        return buildAggregateText({ template, versionFields, assignments, submissions, now: now() });
    }

    async function evaluateSubmission({ assignmentId, managerId, criteriaScores, comment }) {
        const assignment = await formRepository.findFormAssignmentById(assignmentId);
        if (!assignment) fail('ASSIGNMENT_NOT_FOUND', 'Không tìm thấy bài gán form này.');
        if (String(assignment.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người tạo form mới đánh giá được.');
        const submission = await formRepository.findFormSubmissionByAssignment(assignmentId);
        if (!submission) fail('WRONG_STATE', 'Chưa có bài nộp để đánh giá.');
        const rubric = assignment.rubric || [];
        if (!Array.isArray(criteriaScores) || criteriaScores.length !== rubric.length ||
            criteriaScores.some(s => !Number.isInteger(s) || s < 1 || s > 5)) {
            fail('SCORE_INVALID', `Chấm đủ ${rubric.length} tiêu chí, điểm 1–5.`);
        }
        const evaluation = {
            criteria: rubric.map((label, i) => ({ label, score: criteriaScores[i] })),
            comment: comment ? String(comment).trim() : null
        };
        await formRepository.saveFormEvaluation(assignmentId, {
            evaluation, evaluatedBy: String(managerId)
        });
        const detail = evaluation.criteria.map(c => `${c.label}: ${c.score}/5`).join(' | ');
        await taskRepository.enqueueOutbox({
            deduplicationKey: `feval:${assignmentId}:${now().getTime()}`,
            chatId: assignment.telegram_user_id_snapshot,
            text: [
                `⭐ Kết quả đánh giá #F-${assignment.display_code} — ${assignment.title}`,
                `${detail}`,
                evaluation.comment ? `💬 ${evaluation.comment}` : null
            ].filter(Boolean).join('\n')
        });
        return { evaluation };
    }

    async function cancelForm({ displayCode, managerId, reason }) {
        if (!reason || !String(reason).trim()) fail('REASON_REQUIRED', 'Hủy form phải có lý do.');
        const template = await loadTemplateByDisplayCode(displayCode);
        if (String(template.created_by) !== String(managerId)) fail('FORBIDDEN', 'Chỉ người tạo form mới hủy được.');
        const cancelled = await formRepository.cancelOpenFormAssignments(template.id);
        for (const assignment of cancelled) {
            await taskRepository.enqueueOutbox({
                deduplicationKey: `fcancel:${assignment.id}:${now().getTime()}`,
                chatId: assignment.telegram_user_id_snapshot,
                text: `🚫 Form #F-${template.display_code} — ${template.title} đã bị hủy.\nLý do: ${String(reason).trim()}`
            });
        }
        return cancelled.length;
    }

    return {
        loadFillableAssignment,
        loadEvaluableAssignment,
        createFormDraft,
        publishForm,
        assignForm,
        submitForm,
        remindDueSoonForms,
        remindOverdueForms,
        aggregateForm,
        evaluateSubmission,
        cancelForm
    };
}
