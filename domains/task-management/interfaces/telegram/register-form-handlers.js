import { FIELD_TYPES, parseFieldLine, validateAnswer } from '../../application/form-service.js';
import { parseDeadlineVi } from './register-task-handlers.js';

const STATE_TTL_MS = 60 * 60 * 1000; // wizard/điền form/chấm điểm tối đa 1 giờ

export function registerFormHandlers({ bot, formService, taskRepository, conversationRegistry = null }) {
    const isDm = (ctx) => ctx.chat?.type === 'private';
    const states = new Map(); // telegram_user_id -> { kind, ... , createdAt }

    const setState = (telegramUserId, state) => {
        conversationRegistry?.set(telegramUserId, 'form-state');
        return states.set(String(telegramUserId), { ...state, createdAt: Date.now() });
    };

    const takeState = (telegramUserId) => {
        const key = String(telegramUserId);
        const state = states.get(key);
        if (!state) return null;
        states.delete(key);
        conversationRegistry?.clear(key);
        if (Date.now() - state.createdAt > STATE_TTL_MS) return null;
        return state;
    };

    const keepState = (telegramUserId, state) => {
        conversationRegistry?.set(telegramUserId, 'form-state');
        return states.set(String(telegramUserId), { ...state, createdAt: Date.now() });
    };

    const dropState = (telegramUserId) => {
        const deleted = states.delete(String(telegramUserId));
        if (deleted) conversationRegistry?.clear(telegramUserId);
        return deleted;
    };

    const cbError = (ctx, error) =>
        ctx.answerCbQuery(error.message || 'Có lỗi xảy ra', { show_alert: true }).catch(() => {});

    const parseFormCode = (text) => {
        const m = /^#?f-?(\d+)$/i.exec(String(text).trim());
        return m ? m[1] : null;
    };

    function fieldQuestion(field, index, total) {
        const typeLabel = FIELD_TYPES[field.type] || field.type;
        const reqLabel = field.required ? ', bắt buộc' : ', không bắt buộc (gõ - để bỏ qua)';
        const lines = [`📝 Câu ${index + 1}/${total}: ${field.label} (${typeLabel}${reqLabel})`];
        if (field.options?.length) lines.push(`Lựa chọn: ${field.options.join(', ')}`);
        if (field.type === 'date') lines.push('Định dạng: DD/MM hoặc DD/MM/YYYY');
        if (field.type === 'link') lines.push('Dán link bắt đầu bằng http(s)://');
        return lines.join('\n');
    }

    // ----- /taoform: wizard tạo form qua hội thoại -----

    bot.command('taoform', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh tạo form chỉ dùng trong tin nhắn riêng với bot.');
        }
        setState(ctx.from.id, { kind: 'form_wizard', step: 'title', draft: { fields: [], rubric: [] } });
        return ctx.reply([
            '🛠 TẠO FORM BÁO CÁO — bước 1/4',
            'Nhập TIÊU ĐỀ form (ví dụ: Báo cáo tuần Telesale). Gõ /huy để bỏ.'
        ].join('\n'));
    });

    bot.command('dsform', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        }
        const rows = await taskRepository.listFormTemplatesByCreator(String(ctx.from.id));
        if (!rows.length) return ctx.reply('Bạn chưa có form nào. Tạo bằng /taoform.');
        const lines = ['📋 FORM CỦA BẠN'];
        for (const row of rows) {
            const version = row.version_no ? ` — v${row.version_no} (phát hành ${new Date(row.published_at).toLocaleDateString('vi-VN')})` : ' — bản nháp';
            lines.push(`#F-${row.display_code} ${row.title} [${row.status}]${version}`, `   Đã gán: ${row.assignment_count} người`);
        }
        return ctx.reply(lines.join('\n'));
    });

    bot.command('giaoform', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh gán form chỉ dùng trong tin nhắn riêng với bot.');
        }
        const parts = (ctx.message?.text || '').replace(/^\/giaoform\s*/i, '').split('|').map(p => p.trim());
        const formCode = parts[0] ? parseFormCode(parts[0]) : null;
        if (!formCode || !parts[1] || !parts[2]) {
            return ctx.reply('Cú pháp: /giaoform #F-101 | NV001,NV002 | 17:30\n(Có thể thêm ngày: 9:00 25/10)');
        }
        const dueAt = parseDeadlineVi(parts[2]);
        if (!dueAt) return ctx.reply('❌ Không đọc được hạn nộp. Dùng HH:MM hoặc HH:MM DD/MM.');

        const codes = parts[1].toUpperCase().split(/[\s,]+/).filter(Boolean);
        const employees = await taskRepository.findEmployeesByCodes(codes);
        const found = new Set(employees.map(e => e.employee_code.toUpperCase()));
        const missing = codes.filter(c => !found.has(c));
        if (missing.length) {
            return ctx.reply(`❌ Không tìm thấy nhân viên (hoặc đã ngừng hoạt động): ${missing.join(', ')}.`);
        }
        const reachable = employees.filter(e => e.telegram_id);
        if (!reachable.length) return ctx.reply('❌ Không nhân viên nào có Telegram ID.');

        try {
            const result = await formService.assignForm({
                displayCode: formCode, managerId: String(ctx.from.id),
                employees: reachable.map(e => ({
                    employeeId: e.id, employeeCode: e.employee_code,
                    employeeName: e.full_name, telegramUserId: e.telegram_id
                })),
                dueAt
            });
            const lines = [`✅ Đã gán #F-${result.template.display_code} cho ${result.created.length} người (hạn ${dueAt.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}).`];
            if (result.template.status === 'PUBLISHED' && result.version.version_no === 1) {
                lines.push('Form đã được phát hành ở phiên bản v1.');
            }
            if (result.skipped.length) lines.push(`⚠️ Bỏ qua (đã được gán trước đó): ${result.skipped.join(', ')}`);
            return ctx.reply(lines.join('\n'));
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    bot.command('tonghop', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        }
        const formCode = parseFormCode((ctx.message?.text || '').replace(/^\/tonghop\s*/i, '').trim());
        if (!formCode) return ctx.reply('Cú pháp: /tonghop #F-101');
        try {
            const text = await formService.aggregateForm({ displayCode: formCode, managerId: String(ctx.from.id) });
            return ctx.reply(text);
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    bot.command('huyform', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        }
        const body = (ctx.message?.text || '').replace(/^\/huyform\s*/i, '').trim();
        const m = /^(#?f-?\d+)\s+\|?\s*([\s\S]+)$/i.exec(body);
        if (!m) return ctx.reply('Cú pháp: /huyform #F-101 <lý do>');
        try {
            const count = await formService.cancelForm({
                displayCode: parseFormCode(m[1]), managerId: String(ctx.from.id), reason: m[2].trim()
            });
            return ctx.reply(`🚫 Đã hủy form, ${count} bài gán đang mở đã được thông báo.`);
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    bot.command('huy', async (ctx, next) => {
        if (dropState(ctx.from.id)) {
            ctx.reply('Đã bỏ thao tác form đang dở.').catch(() => {});
        }
        return next();
    });

    // ----- Nút: điền form, đánh giá, lưu wizard -----

    bot.action(/^report:fill:(\d+)$/, async (ctx) => {
        const assignmentId = Number(ctx.match[1]);
        try {
            const assignment = await formService.loadFillableAssignment(assignmentId, String(ctx.from.id));
            const fields = assignment.fields || [];
            setState(ctx.from.id, {
                kind: 'form_fill', assignmentId, fields, index: 0, answers: {}
            });
            await ctx.answerCbQuery().catch(() => {});
            return ctx.reply([
                `📝 ĐIỀN FORM #F-${assignment.display_code} — ${assignment.title}`,
                '',
                fieldQuestion(fields[0], 0, fields.length)
            ].join('\n'));
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    bot.action(/^report:eval:(\d+)$/, async (ctx) => {
        const assignmentId = Number(ctx.match[1]);
        try {
            const assignment = await formService.loadEvaluableAssignment(assignmentId, String(ctx.from.id));
            const rubric = assignment.rubric || [];
            setState(ctx.from.id, { kind: 'form_eval', assignmentId, rubric, index: 0, scores: [] });
            await ctx.answerCbQuery().catch(() => {});
            return ctx.reply(`⭐ Chấm điểm "${rubric[0]}" (thang 1–5, 5 = tốt nhất):`);
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    bot.action('report:fok', async (ctx) => {
        const state = takeState(ctx.from.id);
        if (!state || state.kind !== 'form_wizard_confirm') {
            return ctx.answerCbQuery('Bản nháp không còn hiệu lực, hãy /taoform lại.', { show_alert: true }).catch(() => {});
        }
        try {
            const template = await formService.createFormDraft({
                createdBy: String(ctx.from.id),
                title: state.draft.title,
                description: state.draft.description,
                rubric: state.draft.rubric,
                fields: state.draft.fields
            });
            await ctx.answerCbQuery('Đã lưu!').catch(() => {});
            return ctx.editMessageText([
                `✅ Đã lưu form #F-${template.display_code} — ${template.title} (bản nháp, ${state.draft.fields.length} câu).`,
                '',
                'Gán cho nhân viên: /giaoform #F-' + template.display_code + ' | NV001,NV002 | 17:30'
            ].join('\n')).catch(() => {});
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    bot.action('report:fno', async (ctx) => {
        takeState(ctx.from.id);
        await ctx.answerCbQuery('Đã hủy.').catch(() => {});
        return ctx.editMessageText('❌ Đã hủy bản nháp form.').catch(() => {});
    });

    // ----- Tin nhắn văn bản: điều khiển wizard / điền form / chấm điểm -----

    bot.on('message', async (ctx, next) => {
        if (!isDm(ctx)) return next();
        const text = ctx.message?.text;
        if (!text) return next();
        if (text.startsWith('/')) return next();

        const state = takeState(ctx.from.id);
        if (!state) return next();

        try {
            if (state.kind === 'form_wizard') {
                return await wizardStep(ctx, state, text);
            }
            if (state.kind === 'form_fill') {
                return await fillStep(ctx, state, text);
            }
            if (state.kind === 'form_fill_confirm') {
                return await submitConfirm(ctx, state, text);
            }
            if (state.kind === 'form_eval') {
                return await evalStep(ctx, state, text);
            }
            if (state.kind === 'form_eval_comment') {
                return await evalCommentStep(ctx, state, text);
            }
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
        return next();
    });

    async function wizardStep(ctx, state, text) {
        const draft = state.draft;
        if (state.step === 'title') {
            draft.title = text.trim();
            setState(ctx.from.id, { ...state, step: 'description', draft });
            return ctx.reply('🛠 Bước 2/4 — nhập MÔ TẢ ngắn (gõ "không" để bỏ qua).');
        }
        if (state.step === 'description') {
            draft.description = /^không$/i.test(text.trim()) ? null : text.trim();
            setState(ctx.from.id, { ...state, step: 'field', draft });
            return ctx.reply([
                '🛠 Bước 3/4 — thêm câu hỏi, mỗi câu một dòng theo dạng:',
                'Nhãn | kiểu [bắt buộc] [gợi ý: A, B]',
                'Kiểu: chuỗi, đoạn, số, tiền, %, ngày, chọn, nhiều, link',
                'Ví dụ: Doanh số | tiền | bắt buộc',
                'Gõ "xong" khi thêm đủ câu hỏi.'
            ].join('\n'));
        }
        if (state.step === 'field') {
            if (/^xong$/i.test(text.trim())) {
                if (!draft.fields.length) {
                    keepState(ctx.from.id, state);
                    return ctx.reply('❌ Form cần ít nhất một câu hỏi. Thêm tiếp hoặc /huy.');
                }
                setState(ctx.from.id, { ...state, step: 'rubric', draft });
                return ctx.reply([
                    '🛠 Bước 4/4 — rubric đánh giá (tùy chọn).',
                    'Nhập các tiêu chí cách nhau bởi dấu phẩy (ví dụ: Đầy đủ, Cụ thể, Tiến độ).',
                    'Gõ "bỏ" nếu không cần rubric.'
                ].join('\n'));
            }
            const existingKeys = new Set(draft.fields.map(f => f.key));
            const parsed = parseFieldLine(text, existingKeys);
            if (parsed.error) {
                keepState(ctx.from.id, state);
                return ctx.reply(`❌ ${parsed.error}`);
            }
            draft.fields.push(parsed.field);
            keepState(ctx.from.id, { ...state, draft });
            return ctx.reply(`✅ Đã thêm câu ${draft.fields.length}: ${parsed.field.label}. Thêm tiếp hoặc gõ "xong".`);
        }
        if (state.step === 'rubric') {
            draft.rubric = /^bỏ$/i.test(text.trim())
                ? []
                : text.split(',').map(r => r.trim()).filter(Boolean);
            setState(ctx.from.id, { kind: 'form_wizard_confirm', draft });
            const lines = [
                '📋 XEM TRƯỚC FORM',
                `Tiêu đề: ${draft.title}`,
                draft.description ? `Mô tả: ${draft.description}` : null,
                `Câu hỏi (${draft.fields.length}):`,
                ...draft.fields.map((f, i) => `  ${i + 1}. ${f.label} — ${FIELD_TYPES[f.type]}${f.required ? ' (bắt buộc)' : ''}${f.options ? ` [${f.options.join(', ')}]` : ''}`),
                draft.rubric.length ? `Rubric: ${draft.rubric.join(', ')}` : 'Rubric: không',
                '',
                'Bấm Lưu để giữ form (mục 25.3: bạn đang xem bản thử trước).'
            ].filter(Boolean);
            return ctx.reply(lines.join('\n'), {
                reply_markup: { inline_keyboard: [[
                    { text: '✅ Lưu form', callback_data: 'report:fok' },
                    { text: '❌ Hủy', callback_data: 'report:fno' }
                ]] }
            });
        }
        return next ? next() : undefined;
    }

    async function fillStep(ctx, state, text) {
        const { fields, index, answers } = state;
        const result = validateAnswer(fields[index], text);
        if (result.error) {
            keepState(ctx.from.id, state);
            return ctx.reply(`❌ ${result.error}\n${fieldQuestion(fields[index], index, fields.length)}`);
        }
        answers[fields[index].key] = result.value;

        if (index + 1 < fields.length) {
            keepState(ctx.from.id, { ...state, index: index + 1, answers });
            return ctx.reply(fieldQuestion(fields[index + 1], index + 1, fields.length));
        }
        const summary = fields.map(f => `• ${f.label}: ${answers[f.key] ?? '(bỏ qua)'}`).join('\n');
        setState(ctx.from.id, { ...state, kind: 'form_fill_confirm', answers });
        return ctx.reply([
            'Xác nhận bài nộp:',
            summary,
            '',
            'Gõ OK để nộp, gõ nội dung khác để điền lại từ đầu.'
        ].join('\n'));
    }

    async function submitConfirm(ctx, state, text) {
        if (!/^ok$/i.test(text.trim())) {
            setState(ctx.from.id, {
                kind: 'form_fill', assignmentId: state.assignmentId,
                fields: state.fields, index: 0, answers: {}
            });
            return ctx.reply('🔁 Điền lại từ đầu. ' + fieldQuestion(state.fields[0], 0, state.fields.length));
        }
        const result = await formService.submitForm({
            assignmentId: state.assignmentId, telegramUserId: String(ctx.from.id), answers: state.answers
        });
        return ctx.reply(result.isLate
            ? '✅ Đã nộp form (TRẺ hạn — đã quá thời hạn nộp).'
            : '✅ Đã nộp form. Cảm ơn bạn!');
    }

    async function evalStep(ctx, state, text) {
        const score = Number(text.trim());
        if (!Number.isInteger(score) || score < 1 || score > 5) {
            keepState(ctx.from.id, state);
            return ctx.reply('❌ Nhập điểm nguyên từ 1 đến 5.');
        }
        state.scores.push(score);
        if (state.index + 1 < state.rubric.length) {
            keepState(ctx.from.id, { ...state, index: state.index + 1, scores: state.scores });
            return ctx.reply(`⭐ Chấm điểm "${state.rubric[state.index + 1]}" (1–5):`);
        }
        setState(ctx.from.id, { kind: 'form_eval_comment', assignmentId: state.assignmentId, rubric: state.rubric, scores: state.scores });
        return ctx.reply('💬 Nhận xét gửi nhân viên (gõ "-" để bỏ qua):');
    }

    async function evalCommentStep(ctx, state, text) {
        await formService.evaluateSubmission({
            assignmentId: state.assignmentId, managerId: String(ctx.from.id),
            criteriaScores: state.scores,
            comment: /^-$/.test(text.trim()) ? null : text
        });
        return ctx.reply('⭐ Đã lưu đánh giá và gửi kết quả cho nhân viên.');
    }
}
