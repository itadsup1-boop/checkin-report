import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createFormService, normalizeFieldType, parseFieldLine, validateAnswer, buildAggregateText
} from '../application/form-service.js';
import { RULE_DEFAULTS } from '../application/rule-config-service.js';
import { createTaskRepository } from '../infrastructure/postgres/task-repository.js';

const FIXED_NOW = new Date('2026-10-19T10:00:00+07:00');

// Task repository thật chỉ để dùng enqueueOutbox trên mock pool — kiểm tra
// outbox form đi đúng bảng và đúng dedup key. Ở đây mock thẳng cho gọn.
function createMockRepos() {
    const state = { templates: [], versions: [], assignments: [], submissions: [], outbox: [] };
    let versionNo = 0;
    let id = 1;

    const formRepository = {
        state,
        async createFormTemplate({ title, description, rubric, fields, createdBy }) {
            const t = {
                id: `ft-${id++}`, display_code: 100 + state.templates.length + 1,
                title, description, rubric: rubric || [], draft_fields: fields || [],
                status: 'DRAFT', created_by: String(createdBy)
            };
            state.templates.push(t);
            return t;
        },
        async findFormTemplateByDisplayCode(code) {
            return state.templates.find(t => t.display_code === Number(code)) || null;
        },
        async addFormVersion({ templateId, fields, publishedBy }) {
            const template = state.templates.find(t => t.id === templateId);
            const version = {
                id: `fv-${id++}`, template_id: templateId,
                version_no: ++versionNo, fields, published_by: String(publishedBy)
            };
            state.versions.push(version);
            template.status = 'PUBLISHED';
            return { version, template };
        },
        async findLatestFormVersion(templateId) {
            return state.versions.filter(v => v.template_id === templateId).at(-1) || null;
        },
        async createFormAssignments({ templateId, versionId, employees, dueAt, createdBy }) {
            const created = [];
            const skipped = [];
            for (const e of employees) {
                if (state.assignments.some(a => a.template_id === templateId && a.telegram_user_id_snapshot === e.telegramUserId)) {
                    skipped.push(e.employeeCode);
                    continue;
                }
                const a = {
                    id: id++, template_id: templateId, version_id: versionId,
                    employee_code_snapshot: e.employeeCode, employee_name_snapshot: e.employeeName,
                    telegram_user_id_snapshot: e.telegramUserId, due_at: dueAt,
                    status: 'OPEN', last_reminded_on: null, overdue_manager_notified_at: null,
                    created_by: String(createdBy)
                };
                state.assignments.push(a);
                created.push(a);
            }
            return { created, skipped };
        },
        async findFormAssignmentById(assignmentId) {
            const a = state.assignments.find(a => a.id === assignmentId);
            if (!a) return null;
            const t = state.templates.find(t => t.id === a.template_id);
            const v = state.versions.find(v => v.id === a.version_id);
            return {
                ...a, display_code: t.display_code, title: t.title, rubric: t.rubric,
                created_by: t.created_by, template_status: t.status,
                fields: v.fields, version_no: v.version_no
            };
        },
        async listFormAssignmentsByTemplate(templateId) {
            return state.assignments
                .filter(a => a.template_id === templateId)
                .map(a => {
                    const s = state.submissions.find(s => s.assignment_id === a.id);
                    return { ...a, submission_id: s?.id ?? null, is_late: s?.is_late ?? null };
                });
        },
        async cancelOpenFormAssignments(templateId) {
            const cancelled = [];
            for (const a of state.assignments) {
                if (a.template_id === templateId && a.status === 'OPEN') {
                    a.status = 'CANCELLED';
                    cancelled.push(a);
                }
            }
            return cancelled;
        },
        async findFormAssignmentsDueSoon() {
            return state.assignments
                .filter(a => a.status === 'OPEN' && !a.last_reminded_on)
                .map(a => {
                    const t = state.templates.find(t => t.id === a.template_id);
                    return { ...a, display_code: t.display_code, title: t.title };
                });
        },
        async findFormAssignmentsOverdue() {
            return state.assignments
                .filter(a => a.status === 'OPEN')
                .map(a => {
                    const t = state.templates.find(t => t.id === a.template_id);
                    return { ...a, display_code: t.display_code, title: t.title, created_by: t.created_by };
                });
        },
        async markFormReminded(assignmentId, today) {
            state.assignments.find(a => a.id === assignmentId).last_reminded_on = today;
        },
        async markFormOverdueManagerNotified(assignmentId) {
            state.assignments.find(a => a.id === assignmentId).overdue_manager_notified_at = FIXED_NOW;
        },
        async createFormSubmission({ assignmentId, versionId, answers, isLate }) {
            const s = {
                id: id++, assignment_id: assignmentId, version_id: versionId,
                answers, is_late: isLate, submitted_at: FIXED_NOW, evaluation: null
            };
            state.submissions.push(s);
            return s;
        },
        async findFormSubmissionByAssignment(assignmentId) {
            return state.submissions.find(s => s.assignment_id === assignmentId) || null;
        },
        async markFormAssignmentSubmitted(assignmentId) {
            const a = state.assignments.find(a => a.id === assignmentId);
            a.status = 'SUBMITTED';
            return a;
        },
        async listFormSubmissionsByTemplate(templateId) {
            return state.submissions
                .filter(s => state.assignments.find(a => a.id === s.assignment_id).template_id === templateId)
                .map(s => {
                    const a = state.assignments.find(a => a.id === s.assignment_id);
                    return { ...s, employee_code_snapshot: a.employee_code_snapshot, employee_name_snapshot: a.employee_name_snapshot };
                });
        },
        async saveFormEvaluation(assignmentId, { evaluation, evaluatedBy }) {
            const s = state.submissions.find(s => s.assignment_id === assignmentId);
            s.evaluation = evaluation;
            s.evaluation_status = 'EVALUATED';
            return s;
        }
    };

    const taskRepository = {
        async enqueueOutbox(row) {
            if (state.outbox.some(o => o.deduplicationKey === row.deduplicationKey)) return null;
            const inserted = { id: id++, ...row, status: 'PENDING' };
            state.outbox.push(inserted);
            return inserted;
        }
    };

    return { formRepository, taskRepository, state };
}

function createSvc() {
    const repos = createMockRepos();
    const service = createFormService({
        formRepository: repos.formRepository, taskRepository: repos.taskRepository, now: () => FIXED_NOW
    });
    return { repos, service };
}

const EMPLOYEES = [
    { employeeId: 'e1', employeeCode: 'NV001', employeeName: 'Nguyễn Văn A', telegramUserId: '111' },
    { employeeId: 'e2', employeeCode: 'NV002', employeeName: 'Trần B', telegramUserId: '222' }
];

const FIELDS = [
    { key: 'doanh_so', label: 'Doanh số', type: 'money', required: true },
    { key: 'khokhan', label: 'Khó khăn', type: 'textarea', required: false }
];

async function seedPublishedForm(service, { dueAt = new Date('2026-10-19T17:30:00+07:00') } = {}) {
    await service.createFormDraft({
        createdBy: '999', title: 'Báo cáo tuần',
        description: 'Báo cáo doanh số tuần', rubric: ['Đầy đủ', 'Cụ thể'], fields: FIELDS
    });
    return service.assignForm({
        displayCode: 101, managerId: '999', employees: EMPLOYEES, dueAt
    });
}

test('normalizeFieldType và parseFieldLine: dòng trường tiếng Việt thành cấu trúc chuẩn', () => {
    assert.equal(normalizeFieldType('Tiền'), 'money');
    assert.equal(normalizeFieldType('chọn'), 'single_choice');
    assert.equal(normalizeFieldType('lạ'), null);

    const parsed = parseFieldLine('Kênh bán | chọn | bắt buộc | gợi ý: Online, Cửa hàng', new Set());
    assert.deepEqual(parsed.field, {
        key: 'kenh_ban', label: 'Kênh bán', type: 'single_choice', required: true,
        options: ['Online', 'Cửa hàng']
    });
    assert.match(parseFieldLine('Kênh bán | chọn', new Set()).error, /options/);
    assert.match(parseFieldLine(' | tiền', new Set()).error, /Thiếu nhãn/);
});

test('parseFieldLine: trùng nhãn tự sinh key khác nhau', () => {
    const keys = new Set();
    const first = parseFieldLine('Doanh số | số', keys);
    keys.add(first.field.key);
    const second = parseFieldLine('Doanh số | số', keys);
    assert.equal(first.field.key, 'doanh_so');
    assert.equal(second.field.key, 'doanh_so_2');
});

test('validateAnswer: số, tiền, phần trăm, ngày, chọn, link', () => {
    assert.deepEqual(validateAnswer({ label: 'S', type: 'money', required: true }, '1.250.000đ'), { value: 1250000 });
    assert.deepEqual(validateAnswer({ label: 'S', type: 'percent', required: true }, '85%'), { value: 85 });
    assert.match(validateAnswer({ label: 'S', type: 'percent', required: true }, '120').error, /0–100/);
    assert.deepEqual(validateAnswer({ label: 'S', type: 'date', required: true }, '25/10'), { value: '2026-10-25' });
    assert.match(validateAnswer({ label: 'S', type: 'date', required: true }, '32/13').error, /không phải ngày hợp lệ/);
    assert.deepEqual(
        validateAnswer({ label: 'S', type: 'single_choice', required: true, options: ['A', 'B'] }, 'B'),
        { value: 'B' }
    );
    assert.match(
        validateAnswer({ label: 'S', type: 'single_choice', required: true, options: ['A', 'B'] }, 'C').error,
        /chỉ nhận/
    );
    assert.deepEqual(
        validateAnswer({ label: 'S', type: 'multi_choice', required: true, options: ['A', 'B', 'C'] }, 'A, C'),
        { value: ['A', 'C'] }
    );
    assert.match(validateAnswer({ label: 'S', type: 'link', required: true }, 'không phải link').error, /http/);
    assert.match(validateAnswer({ label: 'S', type: 'text', required: true }, '').error, /bắt buộc/);
    assert.deepEqual(validateAnswer({ label: 'S', type: 'text', required: false }, '-'), { value: null });
});

test('assignForm: bản nháp tự phát hành, gán 2 người, gửi form kèm nút điền', async () => {
    const { service, repos } = createSvc();
    await service.createFormDraft({
        createdBy: '999', title: 'Báo cáo tuần', rubric: ['Đầy đủ'], fields: FIELDS
    });
    const result = await service.assignForm({
        displayCode: 101, managerId: '999', employees: EMPLOYEES,
        dueAt: new Date('2026-10-19T17:30:00+07:00')
    });

    assert.equal(result.created.length, 2);
    assert.equal(repos.state.templates[0].status, 'PUBLISHED');
    const msgs = repos.state.outbox.filter(o => o.deduplicationKey.startsWith('formmsg:'));
    assert.equal(msgs.length, 2);
    assert.match(msgs[0].text, /#F-101 — Báo cáo tuần/);
    assert.equal(msgs[0].replyMarkup.inline_keyboard[0][0].callback_data, `report:fill:${result.created[0].id}`);
    assert.equal(msgs[0].linkMeta.direction, 'FORM_FILL');

    // gán lần nữa: người đã có assignment bị bỏ qua
    const again = await service.assignForm({
        displayCode: 101, managerId: '999', employees: EMPLOYEES,
        dueAt: new Date('2026-10-20T17:30:00+07:00')
    });
    assert.equal(again.created.length, 0);
    assert.equal(again.skipped.length, 2);
});

test('assignForm: hạn trong quá khứ và người lạ bị chặn', async () => {
    const { service } = createSvc();
    await seedPublishedForm(service);
    await assert.rejects(
        service.assignForm({
            displayCode: 101, managerId: '999', employees: EMPLOYEES,
            dueAt: new Date('2026-10-19T08:00:00+07:00')
        }),
        e => e.code === 'DUE_IN_PAST'
    );
    await assert.rejects(
        service.assignForm({
            displayCode: 101, managerId: '777', employees: EMPLOYEES,
            dueAt: new Date('2026-10-20T17:30:00+07:00')
        }),
        e => e.code === 'FORBIDDEN'
    );
});

test('submitForm: validate từng trường, trễ được đánh dấu, báo người tạo kèm nút đánh giá', async () => {
    const { service, repos } = createSvc();
    const { created } = await seedPublishedForm(service);
    const assignmentId = created[0].id;

    await assert.rejects(
        service.submitForm({
            assignmentId, telegramUserId: '111',
            answers: { khokhan: 'Thiếu khách' } // thiếu doanh_so bắt buộc
        }),
        e => e.code === 'ANSWER_INVALID'
    );
    await assert.rejects(
        service.submitForm({ assignmentId, telegramUserId: '222', answers: { doanh_so: 1 } }),
        e => e.code === 'NOT_ASSIGNEE'
    );

    const result = await service.submitForm({
        assignmentId, telegramUserId: '111',
        answers: { doanh_so: '1.250.000đ', khokhan: 'Khách hẹn lại' }
    });
    assert.equal(result.isLate, false); // hạn 17:30 hôm nay, nộp lúc 10:00
    assert.equal(repos.state.submissions[0].answers.doanh_so, 1250000);
    const a = repos.state.assignments.find(a => a.id === assignmentId);
    assert.equal(a.status, 'SUBMITTED');

    const notify = repos.state.outbox.find(o => o.deduplicationKey.startsWith('fsub:'));
    assert.match(notify.text, /Nguyễn Văn A đã nộp form/);
    assert.equal(notify.replyMarkup.inline_keyboard[0][0].callback_data, `report:eval:${assignmentId}`);

    await assert.rejects(
        service.submitForm({ assignmentId, telegramUserId: '111', answers: { doanh_so: 1 } }),
        e => e.code === 'WRONG_STATE'
    );
});

test('tổng hợp: đếm đủ/thiếu/trễ, sum/avg trường số, dẫn nguồn submission', async () => {
    const { service, repos } = createSvc();
    const { created } = await seedPublishedForm(service);
    await service.submitForm({
        assignmentId: created[0].id, telegramUserId: '111',
        answers: { doanh_so: 1250000, khokhan: 'Khách hẹn lại mai' }
    });
    // NV002 nộp trễ bằng cách seed thẳng (hạn đã quá)
    repos.state.assignments.find(a => a.id === created[1].id).due_at = new Date('2026-10-19T08:00:00+07:00');
    await service.submitForm({
        assignmentId: created[1].id, telegramUserId: '222',
        answers: { doanh_so: 2300000, khokhan: '-' }
    });

    const text = await service.aggregateForm({ displayCode: 101, managerId: '999' });
    assert.match(text, /Phải nộp: 2 \| Đã nộp: 2 \(trễ 1\)/);
    assert.match(text, /Doanh số: tổng 3\.550\.000 \| trung bình 1\.775\.000/);
    assert.match(text, /NV001 \(submission #\d+\): 1\.250\.000/);
    assert.match(text, /NV002 \(submission #\d+ \[trễ\]\): 2\.300\.000/);
    assert.match(text, /Khách hẹn lại mai/);
    assert.doesNotMatch(text, /NV002.*Khó khăn/); // trả lời '-' thì không liệt kê
});

test('nhắc form sắp hạn và quá hạn: dedup theo ngày, người tạo được báo sau 2 giờ', async () => {
    const { service, repos } = createSvc();
    await seedPublishedForm(service);
    // hạ deadline về quá khứ 3 tiếng để tạo tình huống quá hạn (assignForm
    // chặn hạn trong quá khứ nên phải hạ sau khi gán)
    for (const a of repos.state.assignments) {
        a.due_at = new Date('2026-10-19T07:00:00+07:00');
    }

    const first = await service.remindOverdueForms();
    assert.equal(first.employeeCount, 2);
    assert.equal(first.managerCount, 2);
    assert.equal(repos.state.outbox.filter(o => o.deduplicationKey.startsWith('fod:')).length, 2);
    assert.equal(repos.state.outbox.filter(o => o.deduplicationKey.startsWith('fodm:')).length, 2);

    const second = await service.remindOverdueForms();
    assert.equal(second.employeeCount, 0); // last_reminded_on đã set hôm nay

    // sắp hạn: không còn assignment OPEN nên 0
    const dueSoon = await service.remindDueSoonForms();
    assert.equal(dueSoon, 0);
});

test('đánh giá rubric: đủ tiêu chí 1–5 mới lưu, gửi kết quả cho nhân viên', async () => {
    const { service, repos } = createSvc();
    const { created } = await seedPublishedForm(service);
    await service.submitForm({
        assignmentId: created[0].id, telegramUserId: '111', answers: { doanh_so: 1000, khokhan: 'x' }
    });

    await assert.rejects(
        service.evaluateSubmission({ assignmentId: created[0].id, managerId: '999', criteriaScores: [4] }),
        e => e.code === 'SCORE_INVALID'
    );
    await service.evaluateSubmission({
        assignmentId: created[0].id, managerId: '999',
        criteriaScores: [4, 3], comment: 'Báo cáo rõ, bổ sung số khách lạnh'
    });
    const submission = repos.state.submissions[0];
    assert.equal(submission.evaluation_status, 'EVALUATED');
    assert.deepEqual(submission.evaluation.criteria, [
        { label: 'Đầy đủ', score: 4 }, { label: 'Cụ thể', score: 3 }
    ]);
    const result = repos.state.outbox.find(o => o.deduplicationKey.startsWith('feval:'));
    assert.match(result.text, /Đầy đủ: 4\/5 \| Cụ thể: 3\/5/);
    assert.match(result.text, /bổ sung số khách lạnh/);
    assert.equal(result.chatId, '111');
});

test('hủy form: cần lý do, chỉ người tạo, chỉ assignment OPEN nhận tin hủy', async () => {
    const { service, repos } = createSvc();
    const { created } = await seedPublishedForm(service);
    await service.submitForm({
        assignmentId: created[0].id, telegramUserId: '111', answers: { doanh_so: 1000 }
    });

    await assert.rejects(
        service.cancelForm({ displayCode: 101, managerId: '999', reason: ' ' }),
        e => e.code === 'REASON_REQUIRED'
    );
    const count = await service.cancelForm({ displayCode: 101, managerId: '999', reason: 'Đổi mẫu báo cáo' });
    assert.equal(count, 1); // NV002 còn OPEN
    const cancelMsg = repos.state.outbox.find(o => o.deduplicationKey.startsWith('fcancel:'));
    assert.equal(cancelMsg.chatId, '222');
});

test('buildAggregateText: form không ai nộp vẫn trả tổng hợp thiếu', () => {
    const text = buildAggregateText({
        template: { display_code: 105, title: 'Báo cáo ngày' },
        versionFields: FIELDS,
        assignments: [{ id: 1, status: 'OPEN', employee_code_snapshot: 'NV001', employee_name_snapshot: 'A' }],
        submissions: [],
        now: FIXED_NOW
    });
    assert.match(text, /Thiếu: NV001 — A/);
    assert.doesNotMatch(text, /Doanh số: tổng/);
});

// ----- P5b: post-filter theo rule config của người gán form -----

function createFakeRuleConfig(configByManager = {}) {
    return {
        async loadConfigsForTick(ids) {
            const map = new Map();
            for (const id of ids) {
                map.set(String(id), { ...RULE_DEFAULTS, ...(configByManager[String(id)] || {}) });
            }
            return map;
        },
        shouldSkip: (c) => !c || c.paused,
        isOverdueManagerDue: () => true,
        isFormOverdueManagerDue: (c, dueAt, nowMs) => nowMs - new Date(dueAt).getTime() >= c.form_overdue_manager_hours * 3600 * 1000,
        isDueSoonWithin: () => true,
        isFormDueSoonWithin: (c, dueAt, nowMs) => new Date(dueAt).getTime() - nowMs <= c.form_due_soon_hours * 3600 * 1000,
        isNotAcceptedLateEnough: () => true
    };
}

function createSvcWithRules(configByManager) {
    const repos = createMockRepos();
    const service = createFormService({
        formRepository: repos.formRepository, taskRepository: repos.taskRepository,
        ruleConfigService: createFakeRuleConfig(configByManager), now: () => FIXED_NOW
    });
    return { repos, service };
}

// Seed form hạn tương lai rồi đẩy hạn về quá khứ (assignForm chặn DUE_IN_PAST)
async function seedOverdueForm(repos, service, dueAt) {
    await seedPublishedForm(service, { dueAt: new Date('2026-10-19T17:30:00+07:00') });
    for (const a of repos.state.assignments) a.due_at = dueAt;
}

test('ruleConfig form: người gán tạm dừng thì không nhắc nhân viên, không báo người gán', async () => {
    const { repos, service } = createSvcWithRules({ 999: { paused: true } });
    await seedOverdueForm(repos, service, new Date('2026-10-19T08:00:00+07:00')); // quá hạn 2 tiếng

    assert.equal(await service.remindDueSoonForms(), 0);
    const overdue = await service.remindOverdueForms();
    assert.equal(overdue.employeeCount, 0);
    assert.equal(overdue.managerCount, 0);
    assert.equal(repos.state.outbox.filter(o => o.deduplicationKey.startsWith('fod')).length, 0);
});

test('ruleConfig form: due soon theo giờ cấu hình — 30 tiếng tới, mặc định 24 không nhắc, config 48 nhắc', async () => {
    const dueAt = new Date('2026-10-20T16:00:00+07:00'); // 30 tiếng sau FIXED_NOW

    const def = createSvcWithRules({});
    await seedPublishedForm(def.service, { dueAt });
    assert.equal(await def.service.remindDueSoonForms(), 0);
    assert.equal(def.repos.state.outbox.filter(o => o.deduplicationKey.startsWith('fna:')).length, 0);

    const custom = createSvcWithRules({ 999: { form_due_soon_hours: 48 } });
    await seedPublishedForm(custom.service, { dueAt });
    assert.equal(await custom.service.remindDueSoonForms(), 2);
    assert.equal(custom.repos.state.outbox.filter(o => o.deduplicationKey.startsWith('fna:')).length, 2);
});

test('ruleConfig form: báo người gán khi quá hạn theo giờ cấu hình (5 giờ thay vì 2)', async () => {
    const { repos, service } = createSvcWithRules({ 999: { form_overdue_manager_hours: 5 } });
    await seedOverdueForm(repos, service, new Date('2026-10-19T08:00:00+07:00')); // quá hạn 2 tiếng

    const result = await service.remindOverdueForms();
    assert.equal(result.employeeCount, 2); // nhân viên vẫn được nhắc
    assert.equal(result.managerCount, 0);  // mới trễ 2 tiếng < 5 tiếng cấu hình
    assert.equal(repos.state.outbox.filter(o => o.deduplicationKey.startsWith('fodm:')).length, 0);
});
