import { randomBytes } from 'node:crypto';
import { buildDryRunText, validateUploadMeta } from '../../application/excel-service.js';
import { vietnamToday, vnWallToUtc } from '../../application/task-service.js';

const STATE_TTL_MS = 15 * 60 * 1000;
const MAX_LISTED_FAILURES = 10;

// /xuatexcel tasks [DD/MM] [DD/MM] hoặc /xuatexcel form #F-101
export function parseXuatExcelArgs(text) {
    const body = String(text).trim().replace(/^\/xuatexcel\s*/i, '');
    const tokens = body.split(/\s+/).filter(Boolean);
    if (!tokens.length || tokens[0].toLowerCase() === 'help') return { help: true };
    const kind = tokens[0].toLowerCase();
    if (kind === 'form') {
        const m = /^#?f-?(\d+)$/i.exec(tokens[1] || '');
        if (!m) return { error: 'Cú pháp: /xuatexcel form #F-101' };
        return { kind: 'FORM', displayCode: m[1] };
    }
    if (kind === 'tasks' || kind === 'task') {
        const today = vietnamToday(new Date()).split('-').map(Number);
        const parseDay = (input) => {
            if (input === undefined) return null;
            const m = /^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?$/.exec(input.trim());
            if (!m) return undefined;
            const day = Number(m[1]);
            const month = Number(m[2]);
            if (day < 1 || day > 31 || month < 1 || month > 12) return undefined;
            return { day, month, year: m[3] ? Number(m[3]) : today[0] };
        };
        if (tokens.length === 1) return { kind: 'TASKS' };
        const from = parseDay(tokens[1]);
        if (from === undefined) return { error: 'Không đọc được ngày bắt đầu. Dùng DD/MM hoặc DD/MM/YYYY.' };
        const to = tokens[2] === undefined ? from : parseDay(tokens[2]);
        if (to === undefined) return { error: 'Không đọc được ngày kết thúc. Dùng DD/MM hoặc DD/MM/YYYY.' };
        return { kind: 'TASKS', from, to };
    }
    return { error: 'Đối số không rõ. Dùng "/xuatexcel tasks" hoặc "/xuatexcel form #F-101".' };
}

export function registerExcelHandlers({ bot, excelService, accessService, conversationRegistry = null }) {
    const isDm = (ctx) => ctx.chat?.type === 'private';
    const states = new Map(); // telegram_user_id -> { draftId, checksum, fileName, rows, createdAt }

    const setState = (telegramUserId, state) => {
        conversationRegistry?.set(telegramUserId, 'excel-state');
        return states.set(String(telegramUserId), { ...state, createdAt: Date.now() });
    };

    const takeState = (telegramUserId, draftId) => {
        const key = String(telegramUserId);
        const state = states.get(key);
        if (!state) return null;
        states.delete(key);
        conversationRegistry?.clear(key);
        if (Date.now() - state.createdAt > STATE_TTL_MS) return null;
        if (draftId && state.draftId !== draftId) return null;
        return state;
    };

    const dropState = (telegramUserId) => {
        const deleted = states.delete(String(telegramUserId));
        if (deleted) conversationRegistry?.clear(telegramUserId);
        return deleted;
    };

    const cbError = (ctx, error) =>
        ctx.answerCbQuery(error.message || 'Có lỗi xảy ra', { show_alert: true }).catch(() => {});

    const requirePermission = async (ctx, permission) => {
        const manager = await accessService.getManager(ctx.from.id);
        if (!accessService.hasPermission(manager, permission)) {
            await ctx.reply('❌ Bạn chưa được cấp quyền Excel. Nhờ admin kích hoạt mã quản lý (/kichhoat) hoặc cấp quyền phù hợp.');
            return null;
        }
        return manager;
    };

    const vnFileNameDate = () => vietnamToday(new Date()).split('-').reverse().join('-');

    bot.command('xuatexcel', async (ctx) => {
        if (!isDm(ctx)) return ctx.reply('❌ Lệnh Excel chỉ dùng trong tin nhắn riêng với bot.');
        const manager = await requirePermission(ctx, 'excel.export');
        if (!manager) return undefined;

        const args = parseXuatExcelArgs(ctx.message?.text || '');
        if (args.help) {
            return ctx.reply([
                '📤 XUẤT EXCEL:',
                '/xuatexcel tasks — nhiệm vụ giao trong 7 ngày tới',
                '/xuatexcel tasks 1/11 15/11 — theo khoảng hạn nộp',
                '/xuatexcel form #F-101 — bài nộp + đánh giá của một form',
                '',
                '📥 IMPORT GIAO VIỆC: gửi thẳng file .xlsx/.csv vào đây',
                'Header bắt buộc: MÃ NV | NỘI DUNG | HẠN — tùy chọn: ƯU TIÊN | NHẮC',
                'Hạn chấp nhận HH:MM hoặc DD/MM/YYYY HH:MM (ô ngày Excel cũng được).',
                'Ưu tiên: cao/gap/thường. Nhắc: x (hàng ngày) hoặc không.',
                'Tối đa 500 dòng, file ≤ 5MB, không nhận .xlsm.'
            ].join('\n'));
        }
        if (args.error) return ctx.reply(`❌ ${args.error}`);

        try {
            if (args.kind === 'TASKS') {
                const fromDate = args.from ? vnWallToUtc(args.from.year, args.from.month, args.from.day, 0, 0) : null;
                const toDate = args.to ? vnWallToUtc(args.to.year, args.to.month, args.to.day + 1, 0, 0) : null;
                const { buffer, count } = await excelService.exportTasks({
                    managerId: String(ctx.from.id), fromDate, toDate
                });
                if (!count) return ctx.reply('Không có nhiệm vụ nào trong khoảng này.');
                return ctx.replyWithDocument({ source: Buffer.from(buffer), filename: `nhiem-vu-${vnFileNameDate()}.xlsx` },
                    { caption: `📤 ${count} dòng nhiệm vụ. Cột "Trạng thái" theo từng người nhận.` });
            }
            const { buffer, count } = await excelService.exportForm({ displayCode: args.displayCode, managerId: String(ctx.from.id) });
            if (!count) return ctx.reply('Form này chưa gán cho ai.');
            return ctx.replyWithDocument({ source: Buffer.from(buffer), filename: `form-F-${args.displayCode}-${vnFileNameDate()}.xlsx` },
                { caption: `📤 ${count} bài gán — kèm bài nộp, điểm rubric và câu trả lời.` });
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    bot.command('huy', async (ctx, next) => {
        // next() để tiếp tục chuỗi /huy của các module khác
        if (dropState(ctx.from.id)) {
            ctx.reply('Đã bỏ thao tác import Excel đang dở.').catch(() => {});
        }
        return next();
    });

    bot.on('document', async (ctx, next) => {
        if (!isDm(ctx)) return next();
        const manager = await requirePermission(ctx, 'excel.import');
        if (!manager) return undefined;

        const doc = ctx.message.document;
        const fileName = doc.file_name || 'file.xlsx';
        const invalid = validateUploadMeta({ fileName, mimeType: doc.mime_type, size: doc.file_size });
        if (invalid) return ctx.reply(`❌ ${invalid}`);

        await ctx.reply('⏳ Đang đọc file và kiểm tra từng dòng…');
        let buffer;
        try {
            const link = await ctx.telegram.getFileLink(doc.file_id);
            const res = await fetch(link);
            if (!res.ok) throw new Error(`Tải file từ Telegram lỗi (HTTP ${res.status}).`);
            buffer = Buffer.from(await res.arrayBuffer());
            const dryRun = await excelService.dryRunTaskImport({ buffer, fileName, managerId: String(ctx.from.id) });

            if (!dryRun.okRows.length) {
                return ctx.reply(buildDryRunText(dryRun));
            }
            const draftId = randomBytes(4).toString('hex');
            setState(ctx.from.id, {
                draftId, checksum: dryRun.checksum, fileName: dryRun.fileName, rows: dryRun.okRows
            });
            const keyboard = [[
                { text: `⬆ Import ${dryRun.okRows.length - dryRun.conflictCount} dòng`, callback_data: `excel:ok:${draftId}` }
            ]];
            if (dryRun.conflictCount > 0) {
                keyboard.push([{ text: `⚠ Import tất cả (kể cả ${dryRun.conflictCount} dòng trùng)`, callback_data: `excel:all:${draftId}` }]);
            }
            keyboard.push([{ text: '❌ Hủy', callback_data: `excel:no:${draftId}` }]);
            return ctx.reply(buildDryRunText(dryRun), {
                reply_markup: { inline_keyboard: keyboard }
            });
        } catch (error) {
            return ctx.reply(`❌ ${error.message}`);
        }
    });

    async function runCommit(ctx, draftId, includeConflicts) {
        const state = takeState(ctx.from.id, draftId);
        if (!state) {
            return ctx.answerCbQuery('Bản kiểm không còn hiệu lực — gửi lại file.', { show_alert: true }).catch(() => {});
        }
        try {
            const { created, skipped, failed } = await excelService.commitTaskImport({
                checksum: state.checksum, fileName: state.fileName,
                rows: state.rows, managerId: String(ctx.from.id), includeConflicts
            });
            await ctx.answerCbQuery('Đã import!').catch(() => {});
            const lines = [`✅ Đã tạo ${created} nhiệm vụ từ file ${state.fileName}.`];
            if (skipped) lines.push(`♻️ Bỏ qua ${skipped} dòng đã import trước đó (trùng file).`);
            if (failed.length) {
                lines.push(`❌ ${failed.length} dòng lỗi:`);
                for (const f of failed.slice(0, MAX_LISTED_FAILURES)) lines.push(`• ${f.reason}`);
                if (failed.length > MAX_LISTED_FAILURES) lines.push(`… và ${failed.length - MAX_LISTED_FAILURES} dòng khác`);
            }
            return ctx.editMessageText(lines.join('\n')).catch(() => {});
        } catch (error) {
            return cbError(ctx, error);
        }
    }

    bot.action(/^excel:(ok|all|no):([0-9a-f]+)$/, async (ctx) => {
        const [, choice, draftId] = ctx.match;
        if (choice === 'no') {
            takeState(ctx.from.id, draftId);
            await ctx.answerCbQuery('Đã hủy.').catch(() => {});
            return ctx.editMessageText('❌ Đã hủy import Excel.').catch(() => {});
        }
        return runCommit(ctx, draftId, choice === 'all');
    });
}
