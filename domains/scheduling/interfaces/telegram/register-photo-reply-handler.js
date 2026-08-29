/**
 * Nhân viên reply ảnh trực tiếp lên tin nhắn lịch khách trong Telegram, thay vì
 * mở Mini App — cách này nhanh hơn khi đang cầm điện thoại ngay tại chỗ.
 *
 * Chỉ nhận ảnh reply vào đúng tin của bot có nội dung lịch khách; các ảnh khác
 * (chấm công, báo cáo…) đi qua handler riêng của chúng.
 */

import {
    parseAppointmentReplyReference,
    normalizeAppointmentIdentityText,
    buildProofReceivedReply
} from '../../domain/appointment-messages.js';

export function registerPhotoReplyHandler({
    kpiComposer,
    repository,
    submitProofPhoto,
    moment,
    fs,
    adminIds = ''
}) {
    kpiComposer.on('photo', async (ctx, next) => {
        try {
            const replyMsg = ctx.message.reply_to_message;
            if (!replyMsg || !replyMsg.from || !replyMsg.from.is_bot) return next();

            const text = replyMsg.text || replyMsg.caption || '';
            const isCustomerNotice = text.includes('ĐÃ ĐẾN') || text.includes('BÁO ĐỘNG LỊCH KHÁCH')
                || text.includes('Mã Lịch') || text.includes('Khách hàng');
            if (!isCustomerNotice) return next();

            // Tin mới có mã lịch. Với tin cũ, dò thêm theo đúng nhóm, ngày,
            // tên/SĐT và giờ hẹn để không nhận nhầm khách trùng tên.
            const reference = parseAppointmentReplyReference(text);
            let aptId = reference.id;
            if (!aptId && reference.customerName && reference.phone) {
                const replyDate = moment.unix(replyMsg.date || ctx.message.date)
                    .utcOffset(7)
                    .format('YYYY-MM-DD');
                const candidates = await repository.findCandidatesByPhoneDateTime(
                    String(ctx.chat.id), reference.phone, replyDate, reference.appointmentTime
                );
                const normalizedName = normalizeAppointmentIdentityText(reference.customerName);
                const exactName = candidates.find(row =>
                    normalizeAppointmentIdentityText(row.customer_name) === normalizedName);
                aptId = exactName?.id || (candidates.length === 1 ? candidates[0].id : null);
            }

            if (!aptId) {
                return ctx.reply('⚠️ Không tìm thấy thông tin lịch hẹn hoặc ảnh này đã được nộp!', { reply_to_message_id: ctx.message.message_id });
            }

            const apt = await repository.findActiveForProof(aptId, String(ctx.chat.id));
            if (!apt) {
                return ctx.reply('⚠️ Lịch đã bị hủy, không thuộc nhóm này hoặc đã có ảnh chứng thực!', { reply_to_message_id: ctx.message.message_id });
            }

            // Với nhóm Báo hẹn khách cũ, nhân viên chỉ tự bổ sung lịch của mình
            // trong 48 giờ. Quá hạn chỉ Quản lý/Admin mới được xử lý hộ.
            const groupRole = await repository.findGroupRole(String(ctx.chat.id));
            if (groupRole === 'report') {
                const clickerId = String(ctx.from.id);
                const isOwner = String(apt.telegram_id) === clickerId;
                const isAdmin = String(adminIds || '')
                    .split(',')
                    .map(value => value.trim())
                    .filter(Boolean)
                    .includes(clickerId);
                const canOverride = isAdmin || await repository.isManagerOfGroup(clickerId, String(ctx.chat.id));

                if (!isOwner && !canOverride) {
                    return ctx.reply('⚠️ Bạn chỉ được bổ sung ảnh cho lịch do chính mình phụ trách!', {
                        reply_to_message_id: ctx.message.message_id
                    });
                }
                if (moment().diff(moment(apt.appointment_time), 'hours', true) > 48 && !canOverride) {
                    return ctx.reply('⚠️ Lịch đã quá 48 giờ. Vui lòng nhờ Quản lý hoặc Admin reply ảnh để xử lý!', {
                        reply_to_message_id: ctx.message.message_id
                    });
                }
            }

            // Lấy file_id lớn nhất (độ phân giải cao nhất)
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);

            const fetch = (await import('node-fetch')).default || globalThis.fetch;
            const resPhoto = await fetch(fileLink.href);
            const buffer = Buffer.from(await resPhoto.arrayBuffer());

            const { filePath, proofUrl } = submitProofPhoto.saveBuffer(apt.id, buffer);

            const saved = await repository.markProofSavedIfPending(aptId, proofUrl);
            if (!saved) {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                return ctx.reply('⚠️ Ảnh chứng thực cho lịch này đã được nộp trước đó!', { reply_to_message_id: ctx.message.message_id });
            }

            await submitProofPhoto.syncProofToSheet(apt, proofUrl);

            await ctx.reply(buildProofReceivedReply(apt), {
                parse_mode: 'HTML',
                reply_to_message_id: ctx.message.message_id
            });
        } catch (e) {
            console.error('Lỗi nhận ảnh từ Telegram:', e);
            ctx.reply('❌ Có lỗi xảy ra khi lưu ảnh, vui lòng tải lên bằng Mini App!', { reply_to_message_id: ctx.message.message_id });
        }
    });
}
