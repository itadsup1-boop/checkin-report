import { randomBytes } from 'node:crypto';
import { formatVnTime, parseDeadlineVi, STATUS_LABEL, vietnamToday, vnWallToUtc } from '../../application/task-service.js';
import { normalizeVi, parseNlpMessage } from './nlp-parser.js';

const DRAFT_TTL_MS = 15 * 60 * 1000;
const ASSIGNEE_CHOICE_TTL_MS = 5 * 60 * 1000;

function endOfVietnamToday(now = new Date()) {
    const [year, month, day] = vietnamToday(now).split('-').map(Number);
    return vnWallToUtc(year, month, day, 23, 59);
}

export function registerNlpHandlers({
    bot, taskService, taskRepository, accessService, messagingService,
    excelService = null, ruleConfigService = null, formService = null, conversationRegistry = null,
    attendanceReportService = null
}) {
    const isDm = ctx => ctx.chat?.type === 'private';
    const taskDrafts = new Map();
    const messageDrafts = new Map();
    const assigneeChoices = new Map();

    const cbError = (ctx, error) =>
        ctx.answerCbQuery(error.message || 'Có lỗi xảy ra', { show_alert: true }).catch(() => {});

    async function requirePermission(ctx, permission, label = 'chức năng này') {
        const manager = await accessService.getManager(ctx.from.id);
        if (!accessService.hasPermission(manager, permission)) {
            await ctx.reply(`❌ Bạn chưa được cấp quyền ${label}. Nhờ admin kích hoạt mã quản lý (/kichhoat) hoặc cấp quyền phù hợp.`);
            return null;
        }
        return manager;
    }

    function taskListText(rows, title) {
        if (!rows.length) return `Không có việc ${title.toLowerCase()}.`;
        return [title, ...rows.map(row => {
            const status = row.assignment_status ? ` — ${STATUS_LABEL[row.assignment_status] || row.assignment_status}` : '';
            return `• #T-${row.display_code} — ${row.title} (hạn ${formatVnTime(row.due_at)})${status}`;
        })].join('\n');
    }

    function nameMatchesQuery(fullName, query) {
        const nameTokens = normalizeVi(fullName).split(' ').filter(Boolean);
        const queryTokens = normalizeVi(query).split(' ').filter(Boolean);
        return queryTokens.length > 0 && queryTokens.every(queryToken =>
            nameTokens.some(nameToken => nameToken === queryToken || nameToken.startsWith(queryToken)));
    }

    function groupMatchesQuery(group, query) {
        const requested = normalizeVi(query);
        const groupName = normalizeVi(group.group_name);
        const groupKey = normalizeVi(group.telegram_group_id);
        return groupName.includes(requested) || requested.includes(groupName) || groupKey === requested;
    }

    async function askAssigneeSelection(ctx, intent) {
        const allEmployees = intent.groupQuery && taskRepository.findAllActiveEmployeesWithGroups
            ? await taskRepository.findAllActiveEmployeesWithGroups()
            : taskRepository.findAllActiveEmployees
                ? await taskRepository.findAllActiveEmployees()
                : await taskRepository.findEmployeesByNames([intent.assigneeQuery]);
        const groupEmployees = intent.groupQuery
            ? allEmployees.filter(employee => groupMatchesQuery(employee, intent.groupQuery))
            : allEmployees;
        if (intent.groupQuery && !groupEmployees.length) {
            return ctx.reply(`❌ Không tìm thấy nhóm "${intent.groupQuery}".`);
        }
        const candidates = groupEmployees.filter(employee =>
            nameMatchesQuery(employee.full_name, intent.assigneeQuery));
        if (!candidates.length) {
            if (intent.groupQuery) {
                return ctx.reply(`❌ Không có thành viên tên "${intent.assigneeQuery}" trong nhóm "${intent.groupQuery}".`);
            }
            return ctx.reply(`❌ Không tìm thấy nhân viên có tên "${intent.assigneeQuery}". Hãy kiểm tra lại tên hoặc dùng mã nhân viên.`);
        }

        const userId = String(ctx.from.id);
        const choiceId = randomBytes(4).toString('hex');
        assigneeChoices.set(userId, { choiceId, candidates, intent, createdAt: Date.now() });
        conversationRegistry?.set(userId, 'nlp-assignee-choice');
        const keyboard = candidates.map((employee, index) => ([{
            text: `${employee.full_name} (${employee.employee_code})${employee.group_name ? ` — ${employee.group_name}` : ''}`,
            callback_data: `nlp:assignee:${choiceId}:${index}`
        }]));
        return ctx.reply([
            `👥 Tìm thấy ${candidates.length} nhân viên phù hợp với "${intent.assigneeQuery}".`,
            'Vui lòng chọn đúng nhân viên để tiếp tục giao việc:'
        ].join('\n'), { reply_markup: { inline_keyboard: keyboard } });
    }

    async function startTaskDraft(ctx, intent) {
        const manager = await requirePermission(ctx, 'tasks.create', 'giao việc');
        if (!manager) return;
        if (!intent.codes.length) {
            if (!intent.assigneeQuery) {
                return ctx.reply('❌ Chưa xác định nhân viên. Hãy ghi mã như NV001 hoặc tên nhân viên.');
            }
            return askAssigneeSelection(ctx, intent);
        }
        if (!intent.title) {
            return ctx.reply('❌ Chưa đủ nội dung công việc. Ví dụ: Giao NV001 gọi khách lúc 5h chiều.');
        }
        const dueAt = intent.dueInput ? parseDeadlineVi(intent.dueInput) : endOfVietnamToday();
        if (!dueAt) return ctx.reply('❌ Không đọc được deadline. Dùng 17:30, 9h mai hoặc 5h chiều.');

        const employees = await taskRepository.findEmployeesByCodes(intent.codes);
        const foundCodes = new Set(employees.map(employee => employee.employee_code.toUpperCase()));
        const missing = intent.codes.filter(code => !foundCodes.has(code));
        if (missing.length) return ctx.reply(`❌ Không tìm thấy nhân viên: ${missing.join(', ')}.`);
        const reachable = employees.filter(employee => employee.telegram_id);
        const unreachable = employees.filter(employee => !employee.telegram_id);
        if (!reachable.length) {
            const labels = employees.map(employee => `${employee.full_name} (${employee.employee_code})`).join(', ');
            return ctx.reply(`❌ ${labels} chưa liên kết Telegram ID nên chưa thể nhận việc. Hãy yêu cầu nhân viên đăng ký tài khoản với bot trước.`);
        }

        const userId = String(ctx.from.id);
        const draftId = randomBytes(4).toString('hex');
        taskDrafts.set(userId, {
            draftId, employees: reachable,
            payload: { title: intent.title, priority: intent.priority, reminderMode: intent.reminderMode, dueAt },
            createdAt: Date.now()
        });
        conversationRegistry?.set(userId, 'nlp-task-draft');
        const lines = [
            '📨 XÁC NHẬN GIAO VIỆC',
            `👥 ${reachable.map(employee => `${employee.employee_code} — ${employee.full_name}`).join(', ')}`,
            unreachable.length ? `⚠️ Bỏ qua (không có Telegram): ${unreachable.map(employee => employee.employee_code).join(', ')}` : null,
            `📝 ${intent.title}`,
            `⏰ Deadline: ${formatVnTime(dueAt)}${intent.dueInput ? '' : ' (mặc định hết ngày hôm nay)'}`,
            intent.priority !== 'NORMAL' ? `🔥 Ưu tiên: ${intent.priority}` : null,
            '',
            'Bấm ✅ Giao để xác nhận hoặc ❌ Hủy.'
        ].filter(Boolean);
        return ctx.reply(lines.join('\n'), {
            reply_markup: { inline_keyboard: [[
                { text: '✅ Giao', callback_data: `nlp:giao:ok:${draftId}` },
                { text: '❌ Hủy', callback_data: `nlp:giao:no:${draftId}` }
            ]] }
        });
    }

    async function startMessageDraft(ctx, intent) {
        const permission = intent.command === 'guitinall' ? 'messages.send_bulk' : 'messages.send_individual';
        if (!await requirePermission(ctx, permission, 'gửi tin nhắn')) return;
        if (!intent.codes.length && !intent.recipientName && !intent.all) {
            return ctx.reply('❌ Chưa xác định người nhận. Hãy nêu mã NV001 hoặc tên như “anh Nam”.');
        }
        try {
            const prepared = await messagingService.prepareMessage({
                managerId: String(ctx.from.id), codes: intent.codes,
                names: intent.recipientName ? [intent.recipientName] : [], all: intent.all, text: intent.content
            });
            const draftId = randomBytes(4).toString('hex');
            messageDrafts.set(String(ctx.from.id), {
                draftId, recipients: prepared.recipients, content: prepared.content, createdAt: Date.now()
            });
            conversationRegistry?.set(ctx.from.id, 'nlp-message-draft');
            const recipientLabel = prepared.recipients.map(employee => `${employee.employee_code} — ${employee.full_name}`).join(', ');
            const lines = [
                intent.command === 'guitinall' ? '📣 XÁC NHẬN GỬI TIN NHÓM' : '📨 XÁC NHẬN GỬI TIN CÁ NHÂN',
                `👥 ${recipientLabel}`,
                prepared.missing.length ? `⚠️ Không tìm thấy: ${prepared.missing.join(', ')}` : null,
                prepared.unreachable.length ? `⚠️ Không có Telegram: ${prepared.unreachable.join(', ')}` : null,
                '', '💬 Nội dung:', prepared.content,
                '', 'Bấm nút gửi để xác nhận.'
            ].filter(Boolean);
            return ctx.reply(lines.join('\n'), {
                reply_markup: { inline_keyboard: [[
                    { text: `📨 Gửi cho ${prepared.recipients.length} người`, callback_data: `nlp:msg:ok:${draftId}` },
                    { text: '❌ Hủy', callback_data: `nlp:msg:no:${draftId}` }
                ]] }
            });
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    }

    async function handleExport(ctx) {
        if (!excelService) return ctx.reply('❌ Chức năng Excel hiện chưa được bật.');
        if (!await requirePermission(ctx, 'excel.export', 'xuất Excel')) return;
        try {
            const { buffer, count } = await excelService.exportTasks({ managerId: String(ctx.from.id) });
            if (!count) return ctx.reply('Không có nhiệm vụ nào trong khoảng mặc định.');
            const date = vietnamToday(new Date()).split('-').reverse().join('-');
            return ctx.replyWithDocument({ source: Buffer.from(buffer), filename: `nhiem-vu-${date}.xlsx` }, {
                caption: `📤 ${count} dòng nhiệm vụ.`
            });
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    }

    async function handleConfig(ctx, intent) {
        const manager = await requirePermission(ctx, 'alerts.view', 'cấu hình nhắc việc');
        if (!manager) return;
        try {
            await ruleConfigService.applyRuleConfig(String(ctx.from.id), intent.key, intent.value);
            const field = ruleConfigService.resolveRuleField(intent.key);
            const unit = field.endsWith('_hours') ? 'giờ' : 'phút';
            return ctx.reply(`✅ Đã lưu ${field.replace(/_/g, ' ')} = ${intent.value} ${unit}.`);
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    }

    async function handleForms(ctx, intent) {
        if (!formService) return ctx.reply('❌ Chức năng báo cáo form hiện chưa được bật.');
        if (!await requirePermission(ctx, 'reports.aggregate', 'báo cáo')) return;
        if (intent.command === 'dsform') {
            const rows = await taskRepository.listFormTemplatesByCreator(String(ctx.from.id));
            if (!rows.length) return ctx.reply('Bạn chưa có form nào.');
            return ctx.reply(['📋 FORM CỦA BẠN', ...rows.map(row => `#F-${row.display_code} ${row.title} [${row.status}]`)].join('\n'));
        }
        if (!intent.displayCode) return ctx.reply('❌ Hãy thêm mã form, ví dụ: tổng hợp #F-101.');
        try {
            const text = await formService.aggregateForm({ displayCode: intent.displayCode, managerId: String(ctx.from.id) });
            return ctx.reply(text);
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    }

    async function handleAttendanceReport(ctx, intent) {
        if (!attendanceReportService) return ctx.reply('❌ Chức năng báo cáo chấm công hiện chưa được bật.');
        const manager = await requirePermission(ctx, 'reports.aggregate', 'báo cáo chấm công');
        if (!manager) return;
        try {
            if (intent.command === 'datbaocao') {
                const result = await attendanceReportService.scheduleDaily({
                    manager, managerId: String(ctx.from.id), chatId: String(ctx.chat.id), intent
                });
                return ctx.reply(`✅ Đã đặt báo cáo chấm công nhóm ${result.groups.map(group => group.group_name).join(', ')} gửi hằng ngày lúc ${result.localTime} (giờ Việt Nam).`);
            }
            return ctx.reply(await attendanceReportService.buildReport({ manager, intent }));
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    }

    bot.action(/^nlp:giao:(ok|no):([0-9a-f]+)$/, async ctx => {
        const [, choice, draftId] = ctx.match;
        const userId = String(ctx.from.id);
        const draft = taskDrafts.get(userId);
        if (!draft || draft.draftId !== draftId || Date.now() - draft.createdAt > DRAFT_TTL_MS) {
            taskDrafts.delete(userId);
            conversationRegistry?.clear(userId);
            return ctx.answerCbQuery('Bản nháp đã hết hạn, hãy nhắn lại lệnh giao việc.', { show_alert: true }).catch(() => {});
        }
        taskDrafts.delete(userId);
        conversationRegistry?.clear(userId);
        if (choice === 'no') {
            await ctx.answerCbQuery('Đã hủy.').catch(() => {});
            return ctx.editMessageText('❌ Đã hủy bản nháp giao việc.').catch(() => {});
        }
        try {
            const result = await taskService.createTask({
                createdBy: userId, ...draft.payload,
                assignees: draft.employees.map(employee => ({
                    employeeId: employee.id, employeeCode: employee.employee_code,
                    employeeName: employee.full_name, telegramUserId: employee.telegram_id,
                    telegramGroupId: employee.telegram_group_id
                })),
                idempotencyKey: `nlp-giao:${userId}:${draftId}`
            });
            await ctx.answerCbQuery('Đã giao việc!').catch(() => {});
            return ctx.editMessageText(result.duplicated
                ? 'ℹ️ Nhiệm vụ này đã được giao trước đó.'
                : `✅ Đã giao #T-${result.task.display_code} cho ${draft.employees.length} người.`).catch(() => {});
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    bot.action(/^nlp:assignee:([0-9a-f]+):(\d+)$/, async ctx => {
        const [, choiceId, candidateIndex] = ctx.match;
        const userId = String(ctx.from.id);
        const selection = assigneeChoices.get(userId);
        if (!selection || selection.choiceId !== choiceId || Date.now() - selection.createdAt > ASSIGNEE_CHOICE_TTL_MS) {
            assigneeChoices.delete(userId);
            conversationRegistry?.clear(userId);
            return ctx.answerCbQuery('Danh sách chọn nhân viên đã hết hạn, hãy gửi lại câu giao việc.', { show_alert: true }).catch(() => {});
        }
        const employee = selection.candidates[Number(candidateIndex)];
        if (!employee) {
            return ctx.answerCbQuery('Lựa chọn nhân viên không hợp lệ.', { show_alert: true }).catch(() => {});
        }
        assigneeChoices.delete(userId);
        conversationRegistry?.clear(userId);
        await ctx.answerCbQuery(`Đã chọn ${employee.full_name}.`).catch(() => {});
        await ctx.editMessageText(`✅ Đã chọn ${employee.full_name} (${employee.employee_code}).`).catch(() => {});
        return startTaskDraft(ctx, {
            ...selection.intent,
            codes: [employee.employee_code],
            assigneeQuery: null
        });
    });

    bot.action(/^nlp:msg:(ok|no):([0-9a-f]+)$/, async ctx => {
        const [, choice, draftId] = ctx.match;
        const userId = String(ctx.from.id);
        const draft = messageDrafts.get(userId);
        if (!draft || draft.draftId !== draftId || Date.now() - draft.createdAt > DRAFT_TTL_MS) {
            messageDrafts.delete(userId);
            conversationRegistry?.clear(userId);
            return ctx.answerCbQuery('Bản nháp đã hết hạn, hãy gửi lại tin nhắn.', { show_alert: true }).catch(() => {});
        }
        messageDrafts.delete(userId);
        conversationRegistry?.clear(userId);
        if (choice === 'no') {
            await ctx.answerCbQuery('Đã hủy.').catch(() => {});
            return ctx.editMessageText('❌ Đã hủy gửi tin.').catch(() => {});
        }
        try {
            const { results } = await messagingService.confirmSend({ managerId: userId, recipients: draft.recipients, text: draft.content });
            await ctx.answerCbQuery('Đã đưa vào hàng gửi.').catch(() => {});
            return ctx.editMessageText(`✅ Đã đưa ${results.length} tin vào hàng gửi.`).catch(() => {});
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    bot.on('message', async (ctx, next) => {
        if (!isDm(ctx)) return next();
        const text = ctx.message?.text;
        const owner = conversationRegistry?.get(ctx.from.id);
        if (!text) return next();
        if (text.startsWith('/')) {
            if (owner === 'nlp-assignee-choice') {
                assigneeChoices.delete(String(ctx.from.id));
                conversationRegistry?.clear(ctx.from.id);
            }
            return next();
        }
        if (owner === 'form-state' || owner === 'task-pending') return next();
        if (owner === 'nlp-task-draft' || owner === 'nlp-message-draft') {
            return ctx.reply('⏳ Hãy bấm nút xác nhận hoặc ❌ Hủy trên bản nháp trước.');
        }
        if (owner) return ctx.reply('⏳ Bạn đang có thao tác chờ xác nhận. Hãy bấm nút trên tin nhắn đó hoặc gõ /huy.');
        const intent = parseNlpMessage(text);
        if (!intent) return next();
        try {
            if (intent.command === 'giao') return startTaskDraft(ctx, intent);
            if (intent.command === 'baocaodiem' || intent.command === 'datbaocao') return handleAttendanceReport(ctx, intent);
            if (intent.command === 'viecsaptoihan') {
                if (!await requirePermission(ctx, 'alerts.view', 'xem cảnh báo')) return;
                const rows = await taskService.listDueSoonForManager(String(ctx.from.id));
                return ctx.reply(taskListText(rows, '⏰ VIỆC SẮP ĐẾN HẠN'));
            }
            if (intent.command === 'viectruhan') {
                if (!await requirePermission(ctx, 'alerts.view', 'xem cảnh báo')) return;
                const rows = await taskService.listOverdueForManager(String(ctx.from.id));
                return ctx.reply(taskListText(rows, '🔴 VIỆC QUÁ HẠN'));
            }
            if (intent.command === 'nhacchua_nhan' || intent.command === 'nhacchuy_han') {
                if (!await requirePermission(ctx, 'alerts.view', 'nhắc việc')) return;
                const count = intent.command === 'nhacchua_nhan'
                    ? await taskService.remindNotAcceptedForManager(String(ctx.from.id))
                    : await taskService.remindDueSoonForManager(String(ctx.from.id));
                return ctx.reply(count ? `✅ Đã gửi ${count} lời nhắc.` : 'Không có việc phù hợp để nhắc lúc này.');
            }
            if (intent.command === 'guitin' || intent.command === 'guitinall') return startMessageDraft(ctx, intent);
            if (intent.command === 'xuatexcel') return handleExport(ctx);
            if (intent.command === 'cauhinh') return handleConfig(ctx, intent);
            if (intent.command === 'dsform' || intent.command === 'tonghop') return handleForms(ctx, intent);
            return next();
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });
}
