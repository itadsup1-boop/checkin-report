/**
 * Đăng ký Telegram handler cho vai trò Telesale:
 * - Lệnh /telesale hoặc /baocao_tele: Gửi nút mở Mini App 10s.
 * - Lệnh /tongket_tele: Xem tổng kết tức thì ngày hôm nay của nhóm.
 */

import crypto from 'node:crypto';
import { isTelesaleReportMessage, parseTelesaleTextMessage } from '../../domain/telesale-text-parser.js';
import { TELESALE_FORM_TEMPLATE, escapeHtml } from '../../domain/telesale-messages.js';

// Cache tạm lưu báo cáo chờ người dùng bấm nút xác nhận tên (TTL 15 phút)
const pendingTelesaleReports = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of pendingTelesaleReports.entries()) {
        if (now > val.expiresAt) {
            pendingTelesaleReports.delete(key);
        }
    }
}, 5 * 60 * 1000).unref();

function stripAccents(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toLowerCase()
        .trim();
}

export function registerTelesaleTelegramHandler({
    bot,
    telesaleRepository,
    summarizeDailyTelesale,
    submitTelesaleReport,
    getGroupRole
}) {
    if (!bot) return;

    // Lệnh /telesale, /baocao_tele, /form_tele: Gửi mẫu form 1 chạm copy kèm nút Mini App
    bot.command(['telesale', 'baocao_tele', 'baocaotele', 'form_tele', 'formtele', 'mau_tele'], async (ctx) => {
        try {
            const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
            if (isGroup) {
                const role = getGroupRole ? await getGroupRole(ctx.chat.id) : null;
                if (role && role !== 'telesale') {
                    // Nếu không phải nhóm telesale thì bỏ qua
                    return;
                }
            }

            const text = `📊 <b>MẪU BÁO CÁO TELESALE HÀNG NGÀY</b>\n\n` +
                `👇 <b>Chạm vào khung bên dưới để sao chép mẫu báo cáo:</b>\n` +
                `<code>${TELESALE_FORM_TEMPLATE}</code>\n\n` +
                `<i>(Điền đúng tên của bạn tại mục "Nhân sự:" và gửi trực tiếp vào nhóm để hệ thống tự động ghi nhận nhé)</i>`;

            const miniAppUrl = process.env.MINI_APP_URL || 'https://bot.adsup.vn';
            let inlineKeyboard = [];

            if (isGroup) {
                const botUsername = ctx.botInfo?.username || process.env.BOT_USERNAME || 'baocao_kpi_adsup_bot';
                const appShortName = process.env.TELEGRAM_MINI_APP_SHORT_NAME || 'app';
                const token = process.env.TELEGRAM_BOT_TOKEN || '';
                const ts = Date.now();
                const groupId = ctx.chat.id.toString();
                const dataString = `telesale:${groupId}:${ts}`;
                const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
                const telesaleUrl = `https://t.me/${botUsername}/${appShortName}?startapp=telesale_${groupId}_${ts}_${sig}`;

                inlineKeyboard.push([{ text: '⚡️ Điền Báo Cáo Telesale', url: telesaleUrl }]);
            } else {
                const directUrl = `${miniAppUrl}/mini-app/telesale.html?user_id=${ctx.from?.id || ''}`;
                inlineKeyboard.push([{ text: '⚡️ Điền Báo Cáo Telesale', web_app: { url: directUrl } }]);
            }

            await ctx.reply(text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            });
        } catch (err) {
            console.error('[Telesale Command Error]:', err.message || err);
        }
    });

    // Lệnh /tongket_tele: Xem nhanh tổng kết trong ngày
    bot.command(['tongket_tele', 'tongkettel'], async (ctx) => {
        try {
            if (summarizeDailyTelesale) {
                await summarizeDailyTelesale();
            }
        } catch (err) {
            console.error('[Telesale Command Error /tongket_tele]:', err.message || err);
        }
    });

    // Xử lý khi nhân sự bấm nút chọn tên của mình từ danh sách gợi ý
    bot.action(/^tele_cf:([^:]+):(.+)$/, async (ctx) => {
        try {
            const draftId = ctx.match[1];
            const actionOrEmpId = ctx.match[2];

            const draft = pendingTelesaleReports.get(draftId);
            if (!draft || Date.now() > draft.expiresAt) {
                pendingTelesaleReports.delete(draftId);
                await ctx.answerCbQuery('⚠️ Yêu cầu xác nhận này đã hết hạn. Vui lòng gửi lại tin nhắn báo cáo mới.', { show_alert: true });
                await ctx.editMessageText('⚠️ Yêu cầu xác nhận báo cáo này đã hết hạn. Vui lòng gửi lại tin nhắn báo cáo mới.').catch(() => {});
                return;
            }

            if (actionOrEmpId === 'cancel') {
                pendingTelesaleReports.delete(draftId);
                await ctx.answerCbQuery('Đã hủy báo cáo.');
                await ctx.editMessageText('❌ Đã hủy xác nhận báo cáo. Bạn có thể gửi lại tin nhắn báo cáo mới bất kỳ lúc nào nhé.').catch(() => {});
                return;
            }

            const selectedMember = draft.candidates.find(c => String(c.id) === String(actionOrEmpId));
            if (!selectedMember) {
                await ctx.answerCbQuery('⚠️ Không tìm thấy nhân sự đã chọn.', { show_alert: true });
                return;
            }

            // Xóa draft khỏi bộ nhớ tạm
            pendingTelesaleReports.delete(draftId);

            // Cập nhật tên chuẩn vào payload và xác định người gửi
            draft.payload.employee_name = selectedMember.full_name;
            const telegramUserId = ctx.from?.id ? ctx.from.id.toString() : draft.telegramUserId;

            // Tiến hành ghi nhận báo cáo
            if (submitTelesaleReport) {
                await submitTelesaleReport({
                    telegramGroupId: draft.groupId,
                    telegramUserId,
                    employeeId: selectedMember.id,
                    payload: draft.payload,
                    replyToMessageId: draft.replyToMessageId
                });
            }

            await ctx.answerCbQuery(`Đã ghi nhận báo cáo cho ${selectedMember.full_name}!`);
            await ctx.editMessageText(
                `✅ <b>ĐÃ XÁC NHẬN BÁO CÁO!</b>\n` +
                `Báo cáo đã được ghi nhận thành công cho nhân sự: <b>${escapeHtml(selectedMember.full_name)}</b>.`,
                { parse_mode: 'HTML' }
            ).catch(() => {});
        } catch (err) {
            console.error('[Telesale Confirm Callback Error]:', err.message || err);
            await ctx.answerCbQuery('⚠️ Có lỗi xảy ra khi xác nhận báo cáo.', { show_alert: true }).catch(() => {});
        }
    });

    // Tự động nhận diện & ghi nhận báo cáo Telesale qua tin nhắn chat trong nhóm
    bot.on('text', async (ctx, next) => {
        try {
            const text = ctx.message?.text;
            if (!text) return next();

            const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';
            const groupId = ctx.chat.id.toString();

            // Nếu trong nhóm, kiểm tra xem có đúng là nhóm Telesale không
            if (isGroup && getGroupRole) {
                const role = await getGroupRole(ctx.chat.id);
                if (role && role !== 'telesale') {
                    return next();
                }
            }

            // Kiểm tra xem tin nhắn có phải cú pháp báo cáo Telesale không
            if (!isTelesaleReportMessage(text)) {
                return next();
            }

            // Bóc tách nội dung báo cáo
            const parsed = parseTelesaleTextMessage(text);
            if (!parsed.isValid) {
                return next();
            }

            const telegramUserId = ctx.from?.id ? ctx.from.id.toString() : null;
            const tgFullName = [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(' ');
            const candidateName = (parsed.employee_name || tgFullName || ctx.from?.username || 'Nhân sự Telesale').trim();

            // Lấy danh sách thành viên trong nhóm Telesale
            let groupMembers = [];
            if (telesaleRepository.findMembersInTelesaleGroup) {
                try {
                    groupMembers = await telesaleRepository.findMembersInTelesaleGroup(groupId);
                } catch (err) {
                    console.error('[Telesale] Lỗi lấy thành viên nhóm:', err.message || err);
                }
            }

            const inputLower = candidateName.toLowerCase();
            const inputNoAccent = stripAccents(candidateName);

            let exactMatch = null;
            const partialCandidates = [];

            for (const member of groupMembers) {
                const mName = (member.full_name || '').trim();
                const mLower = mName.toLowerCase();
                const mNoAccent = stripAccents(mName);

                // Khớp chính xác 100% (cùng chữ có dấu hoặc không dấu giống hoàn toàn)
                if (mLower === inputLower || (mNoAccent === inputNoAccent && mNoAccent.length >= 3 && mName.length === candidateName.length)) {
                    exactMatch = member;
                    break;
                }

                // Gần giống / Tên gọi rút gọn:
                // 1. Tên nhân sự kết thúc bằng tên nhập vào (ví dụ "Trịnh Khánh Phương" kết thúc bằng "Phương" hoặc "phuong")
                const isEndsWith = mLower.endsWith(' ' + inputLower) || mNoAccent.endsWith(' ' + inputNoAccent);
                // 2. Chứa từ khóa
                const isIncludes = (inputLower.length >= 2 && mLower.includes(inputLower)) || (inputNoAccent.length >= 2 && mNoAccent.includes(inputNoAccent));
                // 3. Người dùng nhập tên kèm tiền tố / hậu tố
                const isReverseIncludes = (mLower.length >= 2 && inputLower.includes(mLower)) || (mNoAccent.length >= 2 && inputNoAccent.includes(mNoAccent));

                if (isEndsWith || isIncludes || isReverseIncludes) {
                    partialCandidates.push(member);
                }
            }

            // Nếu không tìm thấy trong nhóm, tìm thử trên bảng employees
            if (!exactMatch && partialCandidates.length === 0 && telesaleRepository.findEmployeeByName) {
                try {
                    const fallbackEmp = await telesaleRepository.findEmployeeByName(candidateName, groupId);
                    if (fallbackEmp) {
                        const fbLower = (fallbackEmp.full_name || '').trim().toLowerCase();
                        if (fbLower === inputLower) {
                            exactMatch = fallbackEmp;
                        } else {
                            partialCandidates.push(fallbackEmp);
                        }
                    }
                } catch (_) {}
            }

            // Chuẩn bị payload nộp báo cáo
            const payload = {
                employee_name: candidateName,
                so_nhan: parsed.so_nhan,
                so_trung_knc_vang: parsed.so_trung_knc_vang,
                lich_pv_moi: parsed.lich_pv_moi,
                lich_pv_cu: parsed.lich_pv_cu,
                lich_ngay_mai: parsed.lich_ngay_mai,
                tong_toi_hnay: parsed.tong_toi_hnay,
                tong_bong_hnay: parsed.tong_bong_hnay,
                tong_ds_hnay: parsed.tong_ds_hnay,
                raw_text: text
            };

            // 1. TRƯỜNG HỢP TRÙNG KHỚP 100%: Ghi nhận luôn!
            if (exactMatch) {
                payload.employee_name = exactMatch.full_name;
                if (submitTelesaleReport) {
                    await submitTelesaleReport({
                        telegramGroupId: groupId,
                        telegramUserId,
                        employeeId: exactMatch.id,
                        payload,
                        replyToMessageId: ctx.message.message_id
                    });
                }
                return next();
            }

            // 2. TRƯỜNG HỢP GẦN GIỐNG: Bot hỏi "Bạn là ai?" kèm nút bấm inline
            if (partialCandidates.length > 0) {
                const draftId = crypto.randomUUID().slice(0, 8);
                pendingTelesaleReports.set(draftId, {
                    groupId,
                    telegramUserId,
                    payload,
                    replyToMessageId: ctx.message.message_id,
                    candidates: partialCandidates,
                    expiresAt: Date.now() + 15 * 60 * 1000 // Hết hạn sau 15 phút
                });

                const inline_keyboard = [];
                for (const c of partialCandidates.slice(0, 6)) {
                    inline_keyboard.push([{
                        text: `👤 ${c.full_name}`,
                        callback_data: `tele_cf:${draftId}:${c.id}`
                    }]);
                }
                inline_keyboard.push([{
                    text: '❌ Không phải tôi (Hủy)',
                    callback_data: `tele_cf:${draftId}:cancel`
                }]);

                await ctx.reply(
                    `❓ <b>XÁC NHẬN NHÂN SỰ NỘP BÁO CÁO</b>\n` +
                    `━━━━━━━━━━━━━━━━\n` +
                    `Bạn vừa điền tên: "<b>${escapeHtml(candidateName)}</b>"\n` +
                    `Hệ thống thấy tên này gần giống với các nhân sự trong nhóm dưới đây.\n\n` +
                    `👉 <b>Bạn là ai? Vui lòng bấm chọn chính xác tên của bạn:</b>`,
                    {
                        parse_mode: 'HTML',
                        reply_to_message_id: ctx.message.message_id,
                        reply_markup: { inline_keyboard }
                    }
                );
                return next();
            }

            // 3. TRƯỜNG HỢP HOÀN TOÀN KHÔNG TÌM THẤY TÊN GẦN GIỐNG
            await ctx.reply(
                `⚠️ <b>KHÔNG TÌM THẤY NHÂN SỰ</b>\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `Hệ thống không tìm thấy nhân sự có tên "<b>${escapeHtml(candidateName)}</b>" trong nhóm Telesale.\n\n` +
                `👉 <i>Vui lòng điền đúng họ tên đầy đủ hoặc gửi lệnh <code>/telesale</code> để kiểm tra lại nhé!</i>`,
                {
                    parse_mode: 'HTML',
                    reply_to_message_id: ctx.message.message_id
                }
            );
        } catch (err) {
            console.error('[Telesale Text Handler Error]:', err.message || err);
            try {
                await ctx.reply(`⚠️ Đã xảy ra lỗi khi ghi nhận báo cáo: ${err.message || 'Lỗi hệ thống'}`, {
                    reply_to_message_id: ctx.message?.message_id
                });
            } catch (_) {}
        }

        return next();
    });
}
