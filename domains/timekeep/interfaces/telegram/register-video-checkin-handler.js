import {
    evaluateMarketingCheckin, isMarketingCheckoutEligible, isCheckoutTrigger,
    isMarketingPolicy, formatMarketingCheckinReply, formatMarketingCheckoutReply
} from '../../domain/marketing-attendance-rules.js';

export function registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets, moment }) {
    const recentUserVideos = new Map();
    const recentUserTexts = new Map();
    const recentUserMedia = new Map();
    const VIDEO_CACHE_TTL = 10 * 60 * 1000;
    const getVideo = m => m?.video || m?.video_note || m?.animation || (m?.document && (m.document.mime_type?.startsWith('video/') || /\.(mp4|mov|avi|mkv|webm|3gp)$/i.test(m.document.file_name || '')) ? m.document : null);

    bot.on(['video', 'video_note', 'animation', 'photo', 'document', 'text', 'edited_message'], async (ctx, next) => {
        try {
            if (!ctx.chat || !['group', 'supergroup'].includes(ctx.chat.type)) return next();
            const msg = ctx.message || ctx.editedMessage;
            if (!msg || !msg.from) return next();

            const telegramId = msg.from.id.toString();
            const telegramGroupId = ctx.chat.id.toString();
            const textOrCaption = (msg.caption || msg.text || '').trim();
            const isCheckoutRequest = isCheckoutTrigger(textOrCaption);

            let videoObj = getVideo(msg);
            const photoObj = msg.photo ? msg.photo.slice(-1)[0] : null;
            const currentMedia = videoObj || photoObj;

            if (currentMedia) {
                recentUserMedia.set(telegramId, {
                    fileId: currentMedia.file_id,
                    mediaObj: currentMedia,
                    type: videoObj ? 'video' : 'photo',
                    timestamp: Date.now(),
                    messageId: msg.message_id
                });
            }

            let policyInfo = null;
            if (typeof checkinRepository.findGroupPolicy === 'function') {
                policyInfo = await checkinRepository.findGroupPolicy(telegramGroupId);
            }
            const isMarketing = policyInfo && isMarketingPolicy(policyInfo.attendance_policy);
            const effectiveDate = policyInfo?.effective_start_date || '2026-09-25';

            // Xử lý check-out dành riêng cho Marketing
            if (isMarketing) {
                const msgMoment = moment.unix(msg.date || Math.floor(Date.now() / 1000)).utcOffset(7);
                const currentTimeStr = msgMoment.format('HH:mm:ss');
                const currentDate = msgMoment.format('YYYY-MM-DD');
                const timestampStr = msgMoment.format('HH:mm:ss - DD/MM/YYYY');
                const checkoutMin = policyInfo?.checkout_min_time || '18:30:00';
                const checkoutMinDisplay = checkoutMin.slice(0, 5);

                let checkoutMedia = currentMedia;
                if (!checkoutMedia && msg.reply_to_message) {
                    const rep = msg.reply_to_message;
                    const repMedia = getVideo(rep) || (rep?.photo ? rep.photo.slice(-1)[0] : null);
                    if (repMedia) checkoutMedia = repMedia;
                }
                if (!checkoutMedia) {
                    const cached = recentUserMedia.get(telegramId);
                    if (cached && (Date.now() - cached.timestamp <= VIDEO_CACHE_TTL)) {
                        checkoutMedia = cached.mediaObj || { file_id: cached.fileId };
                    }
                }

                const isEveningVideo = Boolean(videoObj && isMarketingCheckoutEligible(currentTimeStr, checkoutMin));
                const isExplicitCheckoutWithMedia = Boolean(isCheckoutRequest && checkoutMedia);

                if (isEveningVideo || isExplicitCheckoutWithMedia) {
                    if (currentDate < effectiveDate) return next();

                    if (!isMarketingCheckoutEligible(currentTimeStr, checkoutMin)) {
                        await ctx.reply(
                            `⚠️ <b>${msg.from.first_name || 'Bạn'}</b> ơi, chưa đến giờ kết thúc ca làm việc (sau ${checkoutMinDisplay})!\nVui lòng thực hiện check-out sau ${checkoutMinDisplay} để được ghi nhận hợp lệ.`,
                            { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
                        );
                        return next();
                    }

                    const user = await findEmployeeContext(telegramId, telegramGroupId);
                    if (!user) {
                        await ctx.reply(
                            `⚠️ <b>${msg.from.first_name || 'Bạn'}</b> ơi, bạn chưa đăng ký tài khoản nhân sự trong hệ thống!\nVui lòng đăng ký tài khoản trước.`,
                            { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
                        );
                        return next();
                    }

                    if (typeof checkinRepository.findCheckInOfDay === 'function') {
                        const existingCheckin = await checkinRepository.findCheckInOfDay({ userId: user.id, date: currentDate });
                        if (!existingCheckin) {
                            await ctx.reply(
                                `⚠️ <b>${msg.from.first_name || 'Bạn'}</b> ơi, bạn chưa thực hiện check-in ca làm việc hôm nay!\nVui lòng liên hệ quản lý nếu có sự cố.`,
                                { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
                            );
                            return next();
                        }
                    }

                    if (typeof checkinRepository.recordCheckOut === 'function') {
                        await checkinRepository.recordCheckOut({
                            userId: user.id,
                            date: currentDate,
                            checkoutTime: msgMoment.format('YYYY-MM-DD HH:mm:ss'),
                            mediaFileId: checkoutMedia?.file_id || null,
                            checkoutStatus: 'HOAN_THANH'
                        });
                    }

                    if (typeof syncSheets === 'function') {
                        syncSheets().catch(e => console.error('[Sheet sync error in checkout]:', e));
                    }

                    recentUserVideos.delete(telegramId);
                    recentUserTexts.delete(telegramId);
                    recentUserMedia.delete(telegramId);

                    await ctx.reply(
                        formatMarketingCheckoutReply({ fullName: user.full_name, role: user.role, timeStr: timestampStr }),
                        { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
                    );
                    return next();
                }
            }

            // ==========================================
            // XỬ LÝ CHECK-IN (VIDEO)
            // ==========================================
            let isReplyCheck = false, isCachedCheck = false, isCachedTextCheck = false;
            const isEditedCheck = !!ctx.editedMessage;

            if (videoObj) {
                recentUserVideos.set(telegramId, { videoObj, timestamp: Date.now(), msgDate: msg.date });
            }

            const hasCheckinKeyword = str => /check|điểm danh|diem danh/i.test(String(str || ''));
            if (hasCheckinKeyword(textOrCaption)) {
                recentUserTexts.set(telegramId, { text: textOrCaption, timestamp: Date.now(), msgDate: msg.date });
            }

            if (!videoObj && msg.reply_to_message) {
                const repliedMsg = msg.reply_to_message;
                if (repliedMsg.from && repliedMsg.from.id.toString() === telegramId) {
                    videoObj = getVideo(repliedMsg);
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

            let hasCheck = hasCheckinKeyword(textOrCaption);
            if (!hasCheck) {
                const cachedText = recentUserTexts.get(telegramId);
                if (cachedText && (Date.now() - cachedText.timestamp) <= VIDEO_CACHE_TTL) {
                    hasCheck = true;
                    isCachedTextCheck = true;
                }
            }
            if (!hasCheck) return next();

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
            } else if (isCachedTextCheck) {
                msgDate = msg.date || Math.floor(Date.now() / 1000);
            }

            const msgMoment = moment.unix(msgDate).utcOffset(7);
            const currentDate = msgMoment.format('YYYY-MM-DD');
            const checkInTime = msgMoment.format('YYYY-MM-DD HH:mm:ss');
            const timestampStr = msgMoment.format('HH:mm:ss - DD/MM/YYYY');

            if (isMarketing) {
                if (typeof checkinRepository.findCheckInOfDay === 'function') {
                    const existingCheckin = await checkinRepository.findCheckInOfDay({ userId: user.id, date: currentDate });
                    if (existingCheckin) {
                        await ctx.reply(
                            `ℹ️ <b>${user.full_name}</b> ơi, hôm nay bạn đã check-in rồi (${existingCheckin.check_in_time})!`,
                            { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
                        );
                        return next();
                    }
                }

                let userSchedule = null;
                if (typeof checkinRepository.findUserScheduleOfDay === 'function') {
                    userSchedule = await checkinRepository.findUserScheduleOfDay(user.id, currentDate);
                }
                const isCa2 = userSchedule?.shift_type === 'CA_2' || userSchedule?.shift_type === 'CA_CHIEU';

                let approvedLateLeave = null;
                if (typeof checkinRepository.findApprovedLateLeaveRequest === 'function') {
                    approvedLateLeave = await checkinRepository.findApprovedLateLeaveRequest(user.id, currentDate);
                }
                const approvedMinutes = Number(approvedLateLeave?.late_minutes) || 0;
                const lateLeaveTag = approvedLateLeave ? (approvedMinutes > 0 ? ` (Xin muộn +${approvedMinutes}p)` : ' (Có đơn xin muộn)') : '';
                const roleDisplay = isCa2 ? `${user.role || 'Marketing'} (Ca 2 - 09:30)${lateLeaveTag}` : `${user.role || 'Marketing'}${lateLeaveTag}`;

                const currentTimeStr = msgMoment.format('HH:mm:ss');
                const isSunday = msgMoment.day() === 0;
                const hasSundaySpecial = isSunday && (Boolean(policyInfo?.marketing_sunday_checkin_deadline) || telegramGroupId === '-5470063387');
                
                let deadline;
                let lateCutoff;
                if (isCa2) {
                    deadline = '09:30:00';
                    lateCutoff = '10:30:00';
                } else {
                    deadline = hasSundaySpecial
                        ? (policyInfo?.marketing_sunday_checkin_deadline || '09:00:00')
                        : (policyInfo?.marketing_checkin_deadline || '08:30:00');
                    lateCutoff = hasSundaySpecial
                        ? (policyInfo?.marketing_sunday_late_cutoff || '10:00:00')
                        : (policyInfo?.marketing_late_cutoff || '09:30:00');
                }

                // Nếu có đơn xin đi muộn đã duyệt: cộng dồn thời gian xin đi muộn vào mốc ca làm
                if (approvedLateLeave && approvedMinutes > 0) {
                    const baseShiftMoment = moment(`${currentDate} ${deadline}`, 'YYYY-MM-DD HH:mm:ss');
                    const extendedDeadlineMoment = baseShiftMoment.clone().add(approvedMinutes, 'minutes');
                    deadline = extendedDeadlineMoment.format('HH:mm:ss');
                    lateCutoff = extendedDeadlineMoment.clone().add(60, 'minutes').format('HH:mm:ss');
                }

                let evalRes;
                if (currentDate < effectiveDate) {
                    evalRes = { isLate: false, penalty: 0, workCredit: 1.0, status: 'DUNG_GIO', reason: `Hướng dẫn / chạy thử (chưa áp dụng phạt trước ${effectiveDate})` };
                } else {
                    evalRes = evaluateMarketingCheckin(currentTimeStr, {
                        deadline, lateCutoff,
                        penalty: policyInfo?.marketing_checkin_penalty !== undefined ? Number(policyInfo.marketing_checkin_penalty) : 50000
                    });
                }

                if (approvedLateLeave) {
                    if (!evalRes.isLate) {
                        evalRes.reason = `Check-in hợp lệ (Đã duyệt đơn xin đi muộn${approvedMinutes > 0 ? ` +${approvedMinutes} phút` : ''})`;
                    } else {
                        evalRes.reason = `Quá thời gian xin đi muộn (hạn sau ${deadline.slice(0, 5)}) - Phạt ${evalRes.penalty.toLocaleString('vi-VN')}đ`;
                    }
                }

                await checkinRepository.insertCheckIn({
                    groupId: user.group_id, userId: user.id, date: currentDate, checkInTime,
                    videoUrl: videoObj.file_id, workCredit: evalRes.workCredit, checkinPenaltyAmount: evalRes.penalty
                });

                if (evalRes.penalty > 0 && typeof checkinRepository.insertLatePenalty === 'function') {
                    const shiftStartMoment = moment(`${currentDate} ${deadline}`, 'YYYY-MM-DD HH:mm:ss');
                    const lateMinutes = Math.max(0, msgMoment.diff(shiftStartMoment, 'minutes'));
                    await checkinRepository.insertLatePenalty({
                        groupId: user.group_id, userId: user.id, date: currentDate, lateMinutes,
                        amount: evalRes.penalty, reason: evalRes.reason
                    });
                }

                if (typeof syncSheets === 'function') {
                    syncSheets().catch(e => console.error('[Sheet sync error in checkin]:', e));
                }

                recentUserVideos.delete(telegramId);
                recentUserTexts.delete(telegramId);

                await ctx.reply(
                    formatMarketingCheckinReply({ fullName: user.full_name, role: roleDisplay, timeStr: timestampStr, evaluation: evalRes }),
                    { parse_mode: 'HTML', reply_to_message_id: msg.message_id }
                );
                return next();
            }

            // NẾU LÀ CLINIC: 100% logic cũ nguyên bản!
            await checkinRepository.insertCheckIn({
                groupId: user.group_id, userId: user.id, date: currentDate, checkInTime, videoUrl: videoObj.file_id
            });
            if (typeof syncSheets === 'function') {
                syncSheets().catch(e => console.error('Sheet sync error:', e));
            }

            recentUserVideos.delete(telegramId);
            recentUserTexts.delete(telegramId);

            let replyNote = '';
            if (isReplyCheck) replyNote = ' (Xác nhận từ video được trả lời)';
            else if (isCachedCheck) replyNote = ' (Xác nhận từ video gửi trước đó)';
            else if (isCachedTextCheck) replyNote = ' (Xác nhận từ tin nhắn check-in gửi trước đó)';
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
