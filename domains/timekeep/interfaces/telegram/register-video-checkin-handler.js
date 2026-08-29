/**
 * Điểm danh bằng cách gửi video thẳng vào nhóm (không qua Mini App): video trực
 * tiếp, reply lại video cũ, hoặc gõ "check" trong vòng 2 phút sau khi vừa gửi
 * video — luôn chỉ nhận video của CHÍNH người đang nhắn, chống điểm danh hộ.
 */
export function registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets, moment }) {
    const recentUserVideos = new Map();
    const VIDEO_CACHE_TTL = 2 * 60 * 1000; // 2 phút

    bot.on(['video', 'video_note', 'text', 'edited_message'], async (ctx, next) => {
        try {
            if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) {
                return next();
            }

            const msg = ctx.message || ctx.editedMessage;
            if (!msg || !msg.from) return next();

            const telegramId = msg.from.id.toString();
            const telegramGroupId = ctx.chat.id.toString();
            let videoObj = msg.video || msg.video_note;
            let isReplyCheck = false;
            let isCachedCheck = false;
            let isEditedCheck = !!ctx.editedMessage;

            if (videoObj) {
                recentUserVideos.set(telegramId, { videoObj, timestamp: Date.now() });
            }

            if (!videoObj && msg.reply_to_message) {
                const repliedMsg = msg.reply_to_message;
                if (repliedMsg.from && repliedMsg.from.id.toString() === telegramId) {
                    videoObj = repliedMsg.video || repliedMsg.video_note;
                    if (videoObj) isReplyCheck = true;
                }
            }

            if (!videoObj) {
                const cached = recentUserVideos.get(telegramId);
                if (cached && (Date.now() - cached.timestamp) <= VIDEO_CACHE_TTL) {
                    videoObj = cached.videoObj;
                    isCachedCheck = true;
                }
            }

            if (!videoObj) return next();

            const textOrCaption = (msg.caption || msg.text || '').trim();
            if (!textOrCaption.toLowerCase().includes('check')) return next();

            const user = await findEmployeeContext(telegramId, telegramGroupId);
            if (!user) {
                await ctx.reply(
                    `⚠️ <b>${msg.from.first_name || 'Bạn'}</b> ơi, bạn chưa đăng ký tài khoản nhân sự trong hệ thống!\nVui lòng đăng ký tài khoản trước khi thực hiện check-in.`,
                    { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
                );
                return next();
            }

            let msgDate = msg.date;
            if (isReplyCheck && msg.reply_to_message) {
                msgDate = msg.reply_to_message.date;
            } else if (isCachedCheck) {
                const cached = recentUserVideos.get(telegramId);
                if (cached) msgDate = Math.floor(cached.timestamp / 1000);
            }

            const msgMoment = moment.unix(msgDate).utcOffset(7);
            const currentDate = msgMoment.format('YYYY-MM-DD');
            const checkInTime = msgMoment.format('YYYY-MM-DD HH:mm:ss');

            await checkinRepository.insertCheckIn({
                groupId: user.group_id, userId: user.id, date: currentDate, checkInTime, videoUrl: videoObj.file_id
            });
            syncSheets().catch(e => console.error('Sheet sync error:', e));

            recentUserVideos.delete(telegramId);

            const timestampStr = msgMoment.format('HH:mm:ss - DD/MM/YYYY');
            let replyNote = '';
            if (isReplyCheck) replyNote = ' (Xác nhận từ video được trả lời)';
            else if (isCachedCheck) replyNote = ' (Xác nhận từ video gửi trước đó)';
            else if (isEditedCheck) replyNote = ' (Xác nhận qua chỉnh sửa caption)';

            await ctx.reply(
                `📸 <b>ĐÃ GHI NHẬN CHECK-IN VIDEO THÀNH CÔNG</b> 📸\n\n` +
                `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
                `💼 <b>Vị trí:</b> ${user.role || 'Nhân viên'}\n` +
                `⏰ <b>Thời gian điểm danh:</b> ${timestampStr}${replyNote}\n\n` +
                `<i>Hệ thống đã lưu video điểm danh của bạn thành công!</i>`,
                { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
            );
        } catch (err) {
            console.error('[Video Checkin Message Handler Error]', err?.stack || err?.message || err);
        }
        return next();
    });
}
