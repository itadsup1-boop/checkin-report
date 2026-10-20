import { randomBytes } from 'node:crypto';
import {
    formatVnTime, STATUS_LABEL, parseDeadlineVi as parseDeadlineViService
} from '../../application/task-service.js';

const DRAFT_TTL_MS = 15 * 60 * 1000;
const PENDING_TTL_MS = 30 * 60 * 1000;

// Re-export để giữ đường import cũ của test/handler khác (hàm thật nằm ở
// task-service — application layer — để excel-service tái sử dụng).
export function parseDeadlineVi(input, now) {
    return parseDeadlineViService(input, now);
}

// /giao NV001,NV002 | nội dung | 17:30 [daily] [!cao]
export function parseGiaoCommand(text) {
    const body = String(text).trim().replace(/^\/giao\s*/i, '');
    const parts = body.split('|').map(p => p.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
        return { error: 'Cú pháp: /giao NV001,NV002 | nội dung | 17:30 [daily] [!cao]\nVí dụ: /giao NV001,NV002 | Gọi lại 20 khách nóng | 17:30 daily !cao' };
    }
    const codes = parts[0].toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (!codes.length) return { error: 'Thiếu mã nhân viên.' };
    const title = parts[1];
    const tokens = parts.slice(2).join(' ').split(/\s+/).filter(Boolean);
    const dueInput = tokens.shift();
    let reminderMode = 'ONCE_BEFORE_DUE';
    let priority = 'NORMAL';
    for (const token of tokens) {
        const flag = token.toLowerCase();
        if (flag === 'daily' || flag === 'hangngay') reminderMode = 'DAILY_AFTER_CHECKIN';
        else if (flag === '!cao') priority = 'HIGH';
        else if (flag === '!gap') priority = 'URGENT';
        else return { error: `Cờ không rõ: "${token}". Dùng daily (nhắc hàng ngày) hoặc !cao / !gap (ưu tiên).` };
    }
    return { codes, title, dueInput, reminderMode, priority };
}

export function registerTaskHandlers({ bot, taskService, taskRepository, conversationRegistry = null }) {
    const isDm = (ctx) => ctx.chat?.type === 'private';
    const drafts = new Map();   // telegram_user_id -> { draftId, employees, payload, createdAt }
    const pending = new Map();  // telegram_user_id -> { kind, displayCode, assigneeId, createdAt }

    const setPending = (telegramUserId, state) => {
        conversationRegistry?.set(telegramUserId, 'task-pending');
        return pending.set(String(telegramUserId), { ...state, createdAt: Date.now() });
    };

    const takePending = (telegramUserId) => {
        const key = String(telegramUserId);
        const state = pending.get(key);
        if (!state) return null;
        pending.delete(key);
        conversationRegistry?.clear(key);
        if (Date.now() - state.createdAt > PENDING_TTL_MS) return null;
        return state;
    };

    const clearPending = (telegramUserId) => {
        const deleted = pending.delete(String(telegramUserId));
        if (deleted) conversationRegistry?.clear(telegramUserId);
        return deleted;
    };

    const clearDraft = (telegramUserId) => {
        const deleted = drafts.delete(String(telegramUserId));
        if (deleted) conversationRegistry?.clear(telegramUserId);
        return deleted;
    };

    const cbError = (ctx, error) =>
        ctx.answerCbQuery(error.message || 'Có lỗi xảy ra', { show_alert: true }).catch(() => {});

    // ----- /giao: bản nháp + xác nhận -----

    bot.command('giao', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh giao việc chỉ dùng trong tin nhắn riêng với bot.');
        }
        const parsed = parseGiaoCommand(ctx.message?.text || '');
        if (parsed.error) return ctx.reply(`❌ ${parsed.error}`);

        const dueAt = parseDeadlineVi(parsed.dueInput);
        if (!dueAt) {
            return ctx.reply('❌ Không đọc được thời gian. Dùng HH:MM hoặc HH:MM DD/MM (ví dụ 17:30 hoặc 9:00 25/10).');
        }

        const employees = await taskRepository.findEmployeesByCodes(parsed.codes);
        const foundCodes = new Set(employees.map(e => e.employee_code.toUpperCase()));
        const missing = parsed.codes.filter(c => !foundCodes.has(c));
        if (missing.length) {
            return ctx.reply(`❌ Không tìm thấy nhân viên (hoặc đã ngừng hoạt động): ${missing.join(', ')}.`);
        }
        const reachable = employees.filter(e => e.telegram_id);
        const unreachable = employees.filter(e => !e.telegram_id);
        if (!reachable.length) {
            return ctx.reply('❌ Không nhân viên nào trong danh sách có Telegram ID để nhận việc.');
        }

        const telegramUserId = String(ctx.from.id);
        const draftId = randomBytes(4).toString('hex');
        drafts.set(telegramUserId, {
            draftId,
            employees: reachable,
            payload: {
                title: parsed.title, reminderMode: parsed.reminderMode,
                priority: parsed.priority, dueAt
            },
            createdAt: Date.now()
        });
        conversationRegistry?.set(telegramUserId, 'task-draft');

        const lines = [
            '📨 XÁC NHẬN GIAO VIỆC',
            `👥 ${reachable.map(e => `${e.employee_code} — ${e.full_name}`).join(', ')}`,
            unreachable.length ? `⚠️ Bỏ qua (không có Telegram): ${unreachable.map(e => e.employee_code).join(', ')}` : null,
            `📝 ${parsed.title}`,
            `⏰ Deadline: ${formatVnTime(dueAt)}`,
            `🔔 Nhắc: ${parsed.reminderMode === 'DAILY_AFTER_CHECKIN' ? 'hàng ngày sau khi nhân viên check-in 15 phút' : 'trước hạn 30 phút'}`,
            parsed.priority !== 'NORMAL' ? `🔥 Ưu tiên: ${parsed.priority}` : null,
            '',
            'Bấm ✅ Giao để xác nhận.'
        ].filter(Boolean);
        return ctx.reply(lines.join('\n'), {
            reply_markup: { inline_keyboard: [[
                { text: '✅ Giao', callback_data: `tmgr:ok:${draftId}` },
                { text: '❌ Hủy', callback_data: `tmgr:no:${draftId}` }
            ]] }
        });
    });

    bot.action(/^tmgr:(ok|no):([a-f0-9]+)$/, async (ctx) => {
        const [, action, draftId] = ctx.match;
        const telegramUserId = String(ctx.from.id);
        const draft = drafts.get(telegramUserId);
        if (!draft || draft.draftId !== draftId) {
            return ctx.answerCbQuery('Bản nháp không còn hiệu lực, hãy /giao lại.', { show_alert: true }).catch(() => {});
        }
        if (Date.now() - draft.createdAt > DRAFT_TTL_MS) {
            drafts.delete(telegramUserId);
            conversationRegistry?.clear(telegramUserId);
            return ctx.answerCbQuery('Bản nháp đã hết hạn (15 phút), hãy /giao lại.', { show_alert: true }).catch(() => {});
        }
        if (action === 'no') {
            drafts.delete(telegramUserId);
            conversationRegistry?.clear(telegramUserId);
            await ctx.answerCbQuery('Đã hủy bản nháp.').catch(() => {});
            return ctx.editMessageText('❌ Đã hủy bản nháp giao việc.').catch(() => {});
        }

        drafts.delete(telegramUserId);
        conversationRegistry?.clear(telegramUserId);
        try {
            const result = await taskService.createTask({
                createdBy: telegramUserId,
                title: draft.payload.title,
                priority: draft.payload.priority,
                reminderMode: draft.payload.reminderMode,
                dueAt: draft.payload.dueAt,
                assignees: draft.employees.map(e => ({
                    employeeId: e.id, employeeCode: e.employee_code,
                    employeeName: e.full_name, telegramUserId: e.telegram_id,
                    telegramGroupId: e.telegram_group_id
                })),
                idempotencyKey: `giao:${telegramUserId}:${draftId}`
            });
            await ctx.answerCbQuery('Đã giao việc!').catch(() => {});
            const text = result.duplicated
                ? 'ℹ️ Nhiệm vụ này đã được giao trước đó (bỏ qua trùng lặp).'
                : `✅ Đã giao #T-${result.task.display_code} cho ${draft.employees.length} người.`;
            return ctx.editMessageText(text).catch(() => {});
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    // ----- Nút của nhân viên -----

    async function updateEmployeeTaskButtons(ctx, displayCode) {
        if (typeof ctx.editMessageReplyMarkup !== 'function') return;
        await ctx.editMessageReplyMarkup({ inline_keyboard: [[
            { text: '💬 Phản hồi', callback_data: `task:comment:${displayCode}` },
            { text: '✔ Hoàn thành', callback_data: `task:complete:${displayCode}` }
        ], [
            taskService.getTaskExtendUrl?.(displayCode)
                ? { text: '⏰ Xin gia hạn', url: taskService.getTaskExtendUrl(displayCode) }
                : { text: '⏰ Xin gia hạn', callback_data: `task:extend:${displayCode}` }
        ]] }).catch(() => {});
    }

    bot.action(/^task:(accept|decline|complete|comment|extend):(\d+)$/, async (ctx) => {
        const [, action, displayCode] = ctx.match;
        const telegramUserId = String(ctx.from.id);
        try {
            if (action !== 'accept') {
                await taskService.assertAssignee({ displayCode, telegramUserId });
            }
            if (action === 'accept') {
                await taskService.acceptTask({ displayCode, telegramUserId });
                await updateEmployeeTaskButtons(ctx, displayCode);
                return ctx.answerCbQuery('✅ Đã nhận việc!').catch(() => {});
            }
            if (action === 'decline') {
                setPending(telegramUserId, {
                    kind: 'decline', displayCode,
                    sourceChatId: ctx.chat?.id,
                    sourceMessageId: ctx.callbackQuery?.message?.message_id || ctx.message?.message_id
                });
                await ctx.answerCbQuery().catch(() => {});
                return ctx.reply(`❌ Vì sao bạn không nhận #T-${displayCode}? Hãy nhập lý do (gõ /huy để bỏ).`);
            }
            if (action === 'complete') {
                await taskService.completeTask({ displayCode, telegramUserId });
                return ctx.answerCbQuery('✔ Đã ghi nhận hoàn thành, chờ người giao duyệt.').catch(() => {});
            }
            if (action === 'comment') {
                setPending(telegramUserId, { kind: 'comment', displayCode });
                await ctx.answerCbQuery().catch(() => {});
                return ctx.reply(`💬 Nhập nội dung phản hồi cho #T-${displayCode} (gõ /huy để bỏ).`);
            }
            await ctx.answerCbQuery().catch(() => {});
            const extendUrl = taskService.getTaskExtendUrl?.(displayCode);
            if (extendUrl) {
                return ctx.reply(`⏰ Mở biểu mẫu để xin gia hạn #T-${displayCode}:`, {
                    reply_markup: { inline_keyboard: [[{ text: '⏰ Mở form gia hạn', url: extendUrl }]] }
                });
            }
            setPending(telegramUserId, { kind: 'extend', displayCode });
            return ctx.reply([
                `⏰ Xin gia hạn #T-${displayCode}. Nhập theo dạng:`,
                'HH:MM | lý do  hoặc  HH:MM DD/MM | lý do',
                'Ví dụ: 10:00 21/10 | Khách xin gọi lại sáng mai'
            ].join('\n'));
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    // ----- Nút của người giao việc -----

    bot.action(/^task:(review_ok|review_no):(\d+):(\d+)$/, async (ctx) => {
        const [, action, displayCode, assigneeId] = ctx.match;
        const managerId = String(ctx.from.id);
        try {
            if (action === 'review_ok') {
                await taskService.reviewApprove({ displayCode, assigneeId, managerId });
                return ctx.answerCbQuery('✅ Đã duyệt.').catch(() => {});
            }
            setPending(managerId, { kind: 'reject', displayCode, assigneeId });
            await ctx.answerCbQuery().catch(() => {});
            return ctx.reply(`❌ Nhập feedback cho #T-${displayCode} (bắt buộc, sẽ gửi cho nhân viên; gõ /huy để bỏ).`);
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    bot.action(/^task:(ext_ok|ext_no):(\d+)$/, async (ctx) => {
        const [, action, requestId] = ctx.match;
        try {
            await taskService.decideExtend({
                requestId, managerId: String(ctx.from.id), approve: action === 'ext_ok'
            });
            return ctx.answerCbQuery(action === 'ext_ok' ? '✅ Đã duyệt gia hạn.' : '❌ Đã từ chối gia hạn.').catch(() => {});
        } catch (error) {
            return cbError(ctx, error);
        }
    });

    bot.action('noop', (ctx) => ctx.answerCbQuery().catch(() => {}));

    // ----- Lệnh xem và hủy -----

    bot.command('congviec', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        }
        const rows = await taskService.listOpenForManager(String(ctx.from.id));
        if (!rows.length) return ctx.reply('Bạn không có nhiệm vụ nào đang mở.');

        const byTask = new Map();
        for (const row of rows) {
            if (!byTask.has(row.display_code)) {
                byTask.set(row.display_code, { title: row.title, due_at: row.due_at, people: [] });
            }
            byTask.get(row.display_code).people.push(row);
        }
        const lines = ['📋 NHIỆM VỤ ĐANG MỞ'];
        for (const [code, task] of byTask) {
            lines.push('', `#T-${code} — ${task.title} (hạn ${formatVnTime(task.due_at)})`);
            for (const person of task.people) {
                const label = STATUS_LABEL[person.assignment_status] || person.assignment_status;
                lines.push(`- ${person.employee_name_snapshot}: ${label}`);
            }
        }
        return ctx.reply(lines.join('\n'));
    });

    bot.command('huytask', async (ctx) => {
        if (!isDm(ctx)) {
            return ctx.reply('❌ Lệnh này chỉ dùng trong tin nhắn riêng với bot.');
        }
        const body = (ctx.message?.text || '').replace(/^\/huytask\s*/i, '').trim();
        const m = /^#?(?:t-?)?(\d+)\s+([\s\S]+)$/i.exec(body);
        if (!m) {
            return ctx.reply('Cú pháp: /huytask #T-101 <lý do>\nVí dụ: /huytask #T-101 Đổi kế hoạch kinh doanh');
        }
        try {
            await taskService.cancelTask({
                displayCode: m[1], managerId: String(ctx.from.id), reason: m[2].trim()
            });
            return ctx.reply(`🚫 Đã hủy #T-${m[1]} và thông báo cho những người chưa xong.`);
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    bot.command('huy', async (ctx, next) => {
        // next() để module form (đăng ký sau) cũng được dọn state của nó
        if (clearPending(ctx.from.id) || clearDraft(ctx.from.id)) {
            await ctx.reply('Đã bỏ thao tác đang dở.');
        }
        return next();
    });

    // ----- Tin nhắn văn bản: trạng thái đang dở trước, rồi định tuyến reply -----

    bot.on('message', async (ctx, next) => {
        const text = ctx.message?.text;
        if (!text) return next();
        const hasPending = pending.has(String(ctx.from.id));
        if (!isDm(ctx) && !hasPending) return next();
        if (text.startsWith('/')) {
            clearPending(ctx.from.id);
            return next();
        }

        const state = takePending(ctx.from.id);
        if (state) {
            try {
                if (state.kind === 'comment') {
                    await taskService.saveEmployeeComment({
                        displayCode: state.displayCode, telegramUserId: String(ctx.from.id), text
                    });
                    return ctx.reply('✅ Đã gửi phản hồi cho người giao việc.');
                }
                if (state.kind === 'decline') {
                    await taskService.declineTask({
                        displayCode: state.displayCode, telegramUserId: String(ctx.from.id), reason: text
                    });
                    if (state.sourceChatId && state.sourceMessageId && bot.telegram?.editMessageReplyMarkup) {
                        await bot.telegram.editMessageReplyMarkup(state.sourceChatId, state.sourceMessageId, undefined, { inline_keyboard: [] }).catch(() => {});
                    }
                    return ctx.reply(`🚫 Đã báo không nhận #T-${state.displayCode} và gửi lý do cho người giao việc.`);
                }
                if (state.kind === 'reject') {
                    await taskService.reviewReject({
                        displayCode: state.displayCode, assigneeId: state.assigneeId,
                        managerId: String(ctx.from.id), feedback: text
                    });
                    return ctx.reply(`🔁 Đã trả lại #T-${state.displayCode} và gửi feedback cho nhân viên.`);
                }
                if (state.kind === 'extend') {
                    const [timePart, ...reasonParts] = text.split('|');
                    const reason = reasonParts.join('|').trim();
                    if (!reason) {
                        setPending(ctx.from.id, state);
                        return ctx.reply('❌ Thiếu lý do. Nhập lại theo dạng: HH:MM [DD/MM] | lý do');
                    }
                    const proposedDueAt = parseDeadlineVi(timePart);
                    if (!proposedDueAt) {
                        setPending(ctx.from.id, state);
                        return ctx.reply('❌ Không đọc được thời gian. Nhập lại: HH:MM [DD/MM] | lý do');
                    }
                    await taskService.requestExtend({
                        displayCode: state.displayCode, telegramUserId: String(ctx.from.id),
                        proposedDueAt, reason
                    });
                    return ctx.reply('⏰ Đã gửi yêu cầu gia hạn, chờ người giao duyệt.');
                }
            } catch (error) {
                return ctx.reply(`❌ ${error.message}`);
            }
        }

        const replyTo = ctx.message.reply_to_message;
        if (replyTo) {
            const link = await taskRepository.findMessageLink(ctx.chat.id, replyTo.message_id).catch(() => null);
            if (link) {
                try {
                    if (link.direction === 'EMPLOYEE_TASK' || link.direction === 'EMPLOYEE_COMMENT') {
                        await taskService.saveEmployeeComment({
                            displayCode: link.display_code, telegramUserId: String(ctx.from.id), text
                        });
                        return ctx.reply('✅ Đã gửi phản hồi cho người giao việc.');
                    }
                    if (link.direction === 'MANAGER_REVIEW' || link.direction === 'MANAGER_COMMENT') {
                        await taskService.saveManagerComment({
                            taskId: link.task_id, assigneeId: link.assignee_id,
                            managerId: String(ctx.from.id), text
                        });
                        return ctx.reply('✅ Đã chuyển phản hồi cho nhân viên.');
                    }
                } catch (error) {
                    return ctx.reply(`❌ ${error.message}`);
                }
            }
        }

        return next();
    });
}
