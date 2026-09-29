import {
    evaluateMarketingCheckin, isMarketingPolicy,
    formatMarketingCheckinReply, formatMarketingCheckoutReply
} from '../domain/marketing-attendance-rules.js';

/**
 * Điểm danh bằng ảnh hoặc video (Check-in / Check-out): lưu ngay vào `tk_check_ins`
 * rồi trả kết quả cho Mini App ngay lập tức, việc gửi ảnh hoặc convert MP4 (nếu cần)
 * và gửi media vào nhóm chạy nền phía sau.
 *
 * Quy tắc:
 * - Hỗ trợ cả Hình Ảnh và Video.
 * - Lần gửi thứ 1 trong ngày: ghi nhận Check-in.
 * - Lần gửi thứ 2 trong ngày: ghi nhận Check-out.
 */
export function createSaveCheckin({
    checkinRepository, scheduleRepository, findEmployeeContext, isSystemAdmin,
    moment, fs, path, exec, bot, sendVideoToRoleGroup, sendPhotoToRoleGroup, uploadDir, syncSheets
}) {
    function decodeMediaFile(req) {
        if (req.file) {
            const originalUploadPath = req.file.path;
            const filename = req.file.filename;
            const ext = path.extname(filename).toLowerCase();
            const isImage = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic'].includes(ext);
            const isMp4 = ['.mp4', '.mov', '.m4v'].includes(ext);
            return {
                mediaUrl: `/mini-app/uploads/checkins/${filename}`,
                originalUploadPath,
                finalMp4Path: isMp4 || isImage ? originalUploadPath : originalUploadPath.replace(ext, '.mp4'),
                isMp4,
                isImage
            };
        }

        const { video_base64: mediaBase64, mime_type: mimeType, telegram_id: telegramId } = req.body;
        if (!mediaBase64 || !mediaBase64.includes(';base64,')) return null;

        const base64Data = mediaBase64.split(';base64,')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        let ext = 'jpg';
        let isMp4 = false;
        let isImage = true;
        if (mimeType) {
            const mimeLower = mimeType.toLowerCase();
            if (mimeLower.includes('image/png')) { ext = 'png'; isImage = true; }
            else if (mimeLower.includes('image/webp')) { ext = 'webp'; isImage = true; }
            else if (mimeLower.includes('image/')) { ext = 'jpg'; isImage = true; }
            else if (mimeLower.includes('mp4') || mimeLower.includes('quicktime') || mimeLower.includes('mov') || mimeLower.includes('m4v')) {
                ext = 'mp4'; isMp4 = true; isImage = false;
            } else if (mimeLower.includes('3gp')) { ext = '3gp'; isImage = false; }
            else if (mimeLower.includes('avi')) { ext = 'avi'; isImage = false; }
            else if (mimeLower.includes('webm')) { ext = 'webm'; isImage = false; }
        }

        const filename = `checkin_${telegramId}_${Date.now()}.${ext}`;
        const originalUploadPath = path.join(uploadDir, filename);
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(originalUploadPath, buffer);

        return {
            mediaUrl: `/mini-app/uploads/checkins/${filename}`,
            originalUploadPath,
            finalMp4Path: isMp4 || isImage ? originalUploadPath : originalUploadPath.replace(`.${ext}`, '.mp4'),
            isMp4,
            isImage
        };
    }

    async function convertAndSendMedia({
        originalUploadPath, finalMp4Path, isMp4, isImage,
        telegramGroupId, user, isCheckout = false, isMarketing = false, evaluation = null
    }) {
        if (!telegramGroupId || !originalUploadPath) return;

        const timestampStr = moment().utcOffset(7).format('HH:mm - DD/MM/YYYY');
        const mediaLabel = isImage ? 'ảnh' : 'video';

        let caption;
        if (isCheckout) {
            if (isMarketing) {
                caption = formatMarketingCheckoutReply({ fullName: user.full_name, role: user.role, timeStr: timestampStr });
            } else {
                caption = `📸 <b>BÁO CÁO CHECK-OUT</b>\n\n` +
                          `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
                          `💼 <b>Vị trí:</b> ${user.role || 'Nhân viên'}\n` +
                          `⏰ <b>Thời gian check-out:</b> ${timestampStr}\n\n` +
                          `<i>Hệ thống đã ghi nhận ${mediaLabel} check-out của bạn thành công!</i>`;
            }
        } else {
            if (isMarketing && evaluation) {
                caption = formatMarketingCheckinReply({ fullName: user.full_name, role: user.role, timeStr: timestampStr, evaluation });
            } else {
                caption = `📸 <b>BÁO CÁO ĐIỂM DANH</b>\n\n` +
                          `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
                          `💼 <b>Vị trí:</b> ${user.role || 'Nhân viên'}\n` +
                          `⏰ <b>Thời gian:</b> ${timestampStr}\n` +
                          `✅ <b>Trạng thái:</b> Ghi nhận điểm danh thành công!`;
            }
        }

        try {
            if (isImage) {
                if (typeof sendPhotoToRoleGroup === 'function') {
                    await sendPhotoToRoleGroup(bot, telegramGroupId, 'timekeep', { source: originalUploadPath }, { caption, parse_mode: 'HTML' }, isCheckout ? 'checkout_photo' : 'checkin_photo');
                } else if (bot?.telegram?.sendPhoto) {
                    await bot.telegram.sendPhoto(telegramGroupId, { source: originalUploadPath }, { caption, parse_mode: 'HTML' });
                }
                return;
            }

            if (!isMp4) {
                await new Promise((resolve, reject) => {
                    exec(`ffmpeg -y -i "${originalUploadPath}" -c:v libx264 -preset fast -crf 28 "${finalMp4Path}"`, error => {
                        if (error) reject(error); else resolve();
                    });
                });
            }
            if (typeof sendVideoToRoleGroup === 'function') {
                await sendVideoToRoleGroup(bot, telegramGroupId, 'timekeep', { source: finalMp4Path }, { caption, parse_mode: 'HTML' }, isCheckout ? 'checkout_video' : 'checkin_video');
            } else if (bot?.telegram?.sendVideo) {
                await bot.telegram.sendVideo(telegramGroupId, { source: finalMp4Path }, { caption, parse_mode: 'HTML' });
            }
        } catch (err) {
            console.error('[Send Checkin/Checkout Media Error]:', err);
        }
    }

    async function saveCheckin(req) {
        const { chat_id: chatId } = req.body;
        const telegramId = req.verifiedTelegramId || req.body.telegram_id;
        if (!telegramId) {
            return { ok: false, status: 400, message: 'Thiếu thông tin Telegram ID!' };
        }

        const user = await findEmployeeContext(telegramId, chatId);
        if (!user) {
            return { ok: false, status: 404, message: 'Nhân sự chưa đăng ký tài khoản! Vui lòng đăng ký trước.' };
        }

        const isAdmin = isSystemAdmin(telegramId) || user.role === 'admin';

        let groupId = user.group_id;
        let telegramGroupId = chatId;
        if (chatId) {
            const group = await scheduleRepository.findGroupByTelegramGroupId(chatId);
            if (group) {
                if (!isAdmin && user.group_id !== group.id) {
                    return { ok: false, status: 404, message: 'Nhân sự chưa đăng ký tài khoản trong nhóm này!' };
                }
                groupId = group.id;
            } else if (!isAdmin) {
                return { ok: false, status: 404, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' };
            }
        } else {
            telegramGroupId = await scheduleRepository.findTelegramGroupId(groupId);
        }

        const media = decodeMediaFile(req);
        if (!media) {
            return { ok: false, status: 400, message: 'Thiếu dữ liệu ảnh hoặc video tải lên!' };
        }

        const currentDate = moment().utcOffset(7).format('YYYY-MM-DD');
        const nowFormatted = moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');
        const currentTimeStr = moment().utcOffset(7).format('HH:mm:ss');

        let existingCheckin = null;
        if (typeof checkinRepository.findCheckInOfDay === 'function') {
            existingCheckin = await checkinRepository.findCheckInOfDay({ userId: user.id, date: currentDate });
        }

        let policyInfo = null;
        if (typeof checkinRepository.findGroupPolicy === 'function' && (telegramGroupId || groupId)) {
            policyInfo = await checkinRepository.findGroupPolicy(telegramGroupId || groupId);
        }
        const isMarketing = policyInfo && isMarketingPolicy(policyInfo.attendance_policy);
        const effectiveDate = policyInfo?.effective_start_date || '2026-09-25';

        // Lấy thông tin ca trực trong ngày (nếu có)
        let userSchedule = null;
        if (typeof checkinRepository.findUserScheduleOfDay === 'function') {
            userSchedule = await checkinRepository.findUserScheduleOfDay(user.id, currentDate);
        } else if (typeof scheduleRepository?.findSchedulesInRange === 'function') {
            const schedules = await scheduleRepository.findSchedulesInRange(user.id, currentDate, currentDate);
            if (schedules && schedules.length > 0) {
                userSchedule = schedules[0];
            }
        }
        const isCa2 = userSchedule?.shift_type === 'CA_2' || userSchedule?.shift_type === 'CA_CHIEU';

        // Lấy thông tin đơn xin đi muộn đã được duyệt (nếu có)
        let approvedLateLeave = null;
        if (typeof checkinRepository.findApprovedLateLeaveRequest === 'function') {
            approvedLateLeave = await checkinRepository.findApprovedLateLeaveRequest(user.id, currentDate);
        }
        const approvedMinutes = Number(approvedLateLeave?.late_minutes) || 0;
        const lateLeaveTag = approvedLateLeave ? (approvedMinutes > 0 ? ` (Xin muộn +${approvedMinutes}p)` : ' (Có đơn xin muộn)') : '';
        const roleDisplay = isCa2 ? `${user.role || 'Nhân viên'} (Ca 2 - 09:30)${lateLeaveTag}` : `${user.role || 'Nhân viên'}${lateLeaveTag}`;

        // Nếu đã có check-in trong ngày => Ghi nhận lần gửi thứ 2 là CHECK-OUT
        if (existingCheckin && existingCheckin.check_in_time) {
            if (typeof checkinRepository.recordCheckOut === 'function') {
                await checkinRepository.recordCheckOut({
                    userId: user.id,
                    date: currentDate,
                    checkoutTime: nowFormatted,
                    mediaFileId: media.mediaUrl,
                    checkoutStatus: 'HOAN_THANH',
                    penaltyAmount: 0
                });
            }
            if (typeof checkinRepository.clearCheckoutPenalty === 'function') {
                await checkinRepository.clearCheckoutPenalty({ userId: user.id, date: currentDate });
            }
            if (typeof syncSheets === 'function') {
                syncSheets().catch(e => console.error('Sheet sync error in checkout:', e));
            }

            return {
                ok: true,
                isCheckout: true,
                message: 'Check-out thành công!',
                runBackgroundTask: () => convertAndSendMedia({
                    ...media,
                    telegramGroupId,
                    user: { ...user, role: roleDisplay },
                    isCheckout: true,
                    isMarketing
                })
            };
        }

        // Lần đầu trong ngày => Ghi nhận CHECK-IN
        let workCredit = 1.0;
        let penaltyAmount = 0;
        let evalRes = null;

        if (isMarketing) {
            const isSunday = moment().utcOffset(7).day() === 0;
            const hasSundaySpecial = isSunday && (Boolean(policyInfo?.marketing_sunday_checkin_deadline) || String(telegramGroupId) === '-5470063387');
            
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

            workCredit = evalRes.workCredit;
            penaltyAmount = evalRes.penalty;

            await checkinRepository.insertCheckIn({
                groupId, userId: user.id, date: currentDate, checkInTime: nowFormatted,
                videoUrl: media.mediaUrl, workCredit, checkinPenaltyAmount: penaltyAmount
            });

            if (penaltyAmount > 0 && typeof checkinRepository.insertLatePenalty === 'function') {
                const shiftStartMoment = moment(`${currentDate} ${deadline}`, 'YYYY-MM-DD HH:mm:ss');
                const lateMinutes = Math.max(0, moment().utcOffset(7).diff(shiftStartMoment, 'minutes'));
                await checkinRepository.insertLatePenalty({
                    groupId, userId: user.id, date: currentDate, lateMinutes,
                    amount: penaltyAmount, reason: evalRes.reason
                });
            }
        } else {
            await checkinRepository.insertCheckIn({
                groupId, userId: user.id, date: currentDate, checkInTime: nowFormatted,
                videoUrl: media.mediaUrl, workCredit: 1.0, checkinPenaltyAmount: 0
            });
        }

        if (typeof syncSheets === 'function') {
            syncSheets().catch(e => console.error('Sheet sync error in checkin:', e));
        }

        let responseMessage = 'Điểm danh (Check-in) thành công!';
        if (isMarketing && evalRes) {
            if (evalRes.isLate) {
                responseMessage = `Ghi nhận Check-in: Đi muộn (${evalRes.reason})`;
            } else {
                responseMessage = 'Điểm danh (Check-in) đúng giờ thành công!';
            }
        }

        return {
            ok: true,
            isCheckout: false,
            message: responseMessage,
            runBackgroundTask: () => convertAndSendMedia({
                ...media,
                telegramGroupId,
                user: { ...user, role: roleDisplay },
                isCheckout: false,
                isMarketing,
                evaluation: evalRes
            })
        };
    }

    return { saveCheckin };
}
