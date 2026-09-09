/**
 * Lưu lịch tuần từ Mini App. Nhân viên đăng ký từ 2 ngày OFF trở lên trong tuần
 * phải có ảnh minh chứng và chờ Quản lý duyệt (trừ khi chính Quản lý đăng ký).
 * Admin có thể sửa lịch của người khác, có thể sửa cả ngày đã qua.
 */

import { validateScheduleDates } from '../domain/schedule-date-policy.js';

function decodeProofImage(proofImageDataUrl, filenamePrefix, fs, path, uploadDir) {
    if (!proofImageDataUrl) return null;
    const matches = proofImageDataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) return null;

    const fileType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');
    const ext = fileType.split('/')[1] || 'png';
    const filename = `${filenamePrefix}_${Date.now()}.${ext}`;

    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), buffer);
    return `/mini-app/uploads/proofs/${filename}`;
}

function shiftDisplayName(shift) {
    if (shift === 'OFF') return 'Nghỉ 🟥';
    if (shift === 'CA_SANG' || shift === 'CA_1') return 'Ca SỚM 🌅';
    if (shift === 'CA_CHIEU' || shift === 'CA_2') return 'Ca MUỘN 🌇';
    if (shift === 'FULL_DAY') return 'Cả ngày 🌞';
    return shift;
}

export function createSaveWeeklySchedule({
    repository, findEmployeeContext, isSystemAdmin, syncSheets,
    fs, path, moment, uploadDir, bot, publicBaseUrl
}) {
    async function saveWeeklySchedule({ telegramId, chatId, targetUserId, days, proofImage }) {
        if (!telegramId || !days || !Array.isArray(days)) {
            return { ok: false, status: 400, message: 'Dữ liệu không hợp lệ!' };
        }

        const caller = await findEmployeeContext(telegramId, chatId);
        if (!caller) {
            return { ok: false, status: 404, message: 'Tài khoản yêu cầu không tồn tại trong hệ thống!' };
        }

        const isAdmin = isSystemAdmin(telegramId) || caller.role === 'admin';

        const dateValidation = validateScheduleDates({
            days, today: moment().utcOffset(7).format('YYYY-MM-DD'), isAdmin
        });
        if (!dateValidation.valid) {
            if (dateValidation.reason === 'PAST_DATE') {
                return {
                    ok: false, status: 400,
                    message: `Không thể đăng ký hoặc thay đổi lịch của ngày đã qua (${moment(dateValidation.date).format('DD/MM/YYYY')}).`
                };
            }
            return { ok: false, status: 400, message: 'Danh sách ngày đăng ký không hợp lệ.' };
        }

        let scheduleRegistrationOpen = true;
        if (chatId) {
            const group = await repository.findGroupByTelegramGroupId(chatId);
            if (group) {
                scheduleRegistrationOpen = group.schedule_registration_open;
                if (!isAdmin && caller.group_id !== group.id) {
                    return { ok: false, status: 404, message: 'Tài khoản yêu cầu không tồn tại trong nhóm này!' };
                }
            } else if (!isAdmin) {
                return { ok: false, status: 404, message: 'Nhóm Telegram này chưa được đăng ký trong hệ thống!' };
            }
        } else if (caller.group_id) {
            scheduleRegistrationOpen = await repository.findGroupRegistrationFlag(caller.group_id);
        }
        caller.schedule_registration_open = scheduleRegistrationOpen;
        const isManager = await repository.isManager(telegramId);

        let targetUser = caller;
        if (targetUserId && targetUserId !== String(caller.id)) {
            if (!isAdmin) {
                return { ok: false, status: 403, message: 'Bạn không có quyền sửa lịch của người khác!' };
            }
            const fetchedTarget = await repository.findEmployeeById(targetUserId);
            if (!fetchedTarget) {
                return { ok: false, status: 404, message: 'Nhân viên đích không tồn tại!' };
            }
            if (fetchedTarget.group_id !== caller.group_id) {
                return { ok: false, status: 403, message: 'Không thể sửa lịch của nhân viên thuộc nhóm khác!' };
            }
            targetUser = fetchedTarget;
        }

        const groupId = targetUser.group_id;

        if (!isAdmin) {
            const startOfCurrentWeek = moment().startOf('isoWeek').format('YYYY-MM-DD');

            for (const day of days) {
                const dayStr = moment(day.date).format('YYYY-MM-DD');
                if (dayStr < startOfCurrentWeek) {
                    return { ok: false, status: 400, message: 'Bạn không thể thay đổi lịch của các tuần cũ!' };
                }

                const startOfWeekOfDay = moment(day.date).startOf('isoWeek');
                const lockThreshold = moment(startOfWeekOfDay).subtract(1, 'days').hours(23).minutes(0).seconds(0);
                if (moment().isSameOrAfter(lockThreshold) && caller.schedule_registration_open === false) {
                    return {
                        ok: false, status: 403,
                        message: `Quản lý đã đóng đăng ký lịch tuần ${startOfWeekOfDay.format('DD/MM/YYYY')}!`
                    };
                }
            }

            for (const day of days) {
                if (day.shift_type !== 'OFF') continue;
                const overlap = await repository.findOffOverlap(groupId, day.date, targetUser.role, targetUser.id);
                if (overlap) {
                    return {
                        ok: false, status: 400,
                        message: `Không thể chọn OFF ngày ${day.date}. Nhân sự "${overlap.full_name}" có cùng vai trò "${targetUser.role}" đã đăng ký nghỉ ngày này!`
                    };
                }
            }

            const offDaysCount = days.filter(d => d.shift_type === 'OFF').length;
            if (offDaysCount >= 2 && !proofImage) {
                return {
                    ok: false, status: 400,
                    message: 'Bạn đăng ký nghỉ từ 2 ngày trở lên trong tuần. Vui lòng tải lên ảnh minh chứng!'
                };
            }

            if (!isManager && offDaysCount >= 2) {
                return requestManagerApproval({
                    repository, fs, path, moment, uploadDir, bot, publicBaseUrl,
                    groupId, targetUser, days, proofImage, chatId
                });
            }
        }

        return applyScheduleDirectly({
            repository, fs, path, moment, uploadDir, bot, syncSheets,
            groupId, caller, targetUser, days, proofImage, isAdmin
        });
    }

    return { saveWeeklySchedule };
}

async function requestManagerApproval({ repository, fs, path, moment, uploadDir, bot, publicBaseUrl, groupId, targetUser, days, proofImage, chatId }) {
    const proofUrl = decodeProofImage(proofImage, `proof_schedule_${targetUser.telegram_id}`, fs, path, uploadDir);
    const startOfWeekStr = moment(days[0].date).startOf('isoWeek').format('YYYY-MM-DD');

    await repository.cancelPendingScheduleChangeRequests(targetUser.id, startOfWeekStr);
    const requestId = await repository.insertScheduleChangeRequest({
        groupId, userId: targetUser.id, weekStartDate: startOfWeekStr, daysJson: JSON.stringify(days), proofUrl
    });

    let telegramGroupId = chatId || await repository.findTelegramGroupId(groupId);
    if (telegramGroupId) {
        const startOfWeekFormatted = moment(startOfWeekStr).format('DD/MM/YYYY');
        const endOfWeekFormatted = moment(startOfWeekStr).endOf('isoWeek').format('DD/MM/YYYY');
        const offDaysDates = days.filter(d => d.shift_type === 'OFF').map(d => moment(d.date).format('DD/MM')).join(', ');

        let msg = `🚨 <b>YÊU CẦU DUYỆT ĐĂNG KÝ LỊCH TUẦN (>= 2 NGÀY NGHỈ)</b>\n\n` +
            `👤 <b>Nhân viên:</b> ${targetUser.full_name}\n` +
            `💼 <b>Vị trí:</b> ${targetUser.role}\n` +
            `📅 <b>Tuần đăng ký:</b> ${startOfWeekFormatted} - ${endOfWeekFormatted}\n` +
            `🌴 <b>Các ngày xin nghỉ:</b> ${offDaysDates}\n`;

        msg += proofUrl
            ? `📸 <b>Minh chứng:</b> <a href="${publicBaseUrl}${proofUrl}">Xem ảnh đính kèm</a>\n`
            : `📸 <b>Minh chứng:</b> Không có\n`;
        msg += `\n------------------------------------------\nVui lòng phê duyệt lịch làm việc của nhân sự này.`;

        await bot.telegram.sendMessage(telegramGroupId, msg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: '✅ Duyệt lịch', callback_data: `approve_leave_${requestId}` },
                    { text: '❌ Từ chối', callback_data: `reject_leave_${requestId}` }
                ]]
            }
        });
    }

    return { ok: true, message: 'Lịch đang chờ Quản lý duyệt do đăng ký nghỉ >= 2 ngày.' };
}

async function applyScheduleDirectly({ repository, fs, path, moment, uploadDir, bot, syncSheets, groupId, caller, targetUser, days, proofImage, isAdmin }) {
    const dateList = days.map(d => moment(d.date).format('YYYY-MM-DD'));
    const existingMap = await repository.findExistingShiftsForDates(targetUser.id, dateList);

    const proofUrl = decodeProofImage(proofImage, `proof_${targetUser.telegram_id}`, fs, path, uploadDir);

    const isModifiedByAdmin = isAdmin && (targetUser.id !== caller.id);
    const adminName = isModifiedByAdmin ? caller.full_name : null;
    const modifiedAt = isModifiedByAdmin ? new Date() : null;

    for (const day of days) {
        const dayStr = moment(day.date).format('YYYY-MM-DD');
        const oldShift = existingMap[dayStr];
        const newShift = day.shift_type;
        const hasChanged = oldShift !== newShift;
        const currentProofUrl = (newShift === 'OFF' && proofUrl) ? proofUrl : null;
        const isLockedValue = isAdmin ? true : false;

        await repository.upsertScheduleDay({
            groupId, userId: targetUser.id, date: day.date, shiftType: newShift, isLocked: isLockedValue,
            proofUrl: currentProofUrl,
            adminName: (isModifiedByAdmin && hasChanged) ? adminName : null,
            modifiedAt: (isModifiedByAdmin && hasChanged) ? modifiedAt : null,
            clearAdminTracking: (!isAdmin && hasChanged)
        });
    }

    if (isModifiedByAdmin) {
        const changesList = [];
        for (const day of days) {
            const dayStr = moment(day.date).format('YYYY-MM-DD');
            const oldShift = existingMap[dayStr] || 'Chưa xếp ca';
            const newShift = day.shift_type;
            if (oldShift !== newShift) {
                const displayDate = moment(day.date).format('DD/MM/YYYY');
                changesList.push(`• <b>${displayDate}</b>: <b>${shiftDisplayName(newShift)}</b> <i>(Trước đó: ${shiftDisplayName(oldShift)})</i>`);
            }
        }

        if (changesList.length > 0 && targetUser.telegram_id) {
            try {
                const timestampStr = moment().format('HH:mm - DD/MM/YYYY');
                const notifyMsg = `🔔 <b>THÔNG BÁO: LỊCH LÀM VIỆC ĐÃ ĐƯỢC THAY ĐỔI</b>\n\n` +
                    `👤 <b>Người thay đổi:</b> Admin <b>${caller.full_name}</b>\n` +
                    `⏰ <b>Thời gian thay đổi:</b> ${timestampStr}\n\n` +
                    `📅 <b>Chi tiết các ca được thay đổi:</b>\n` +
                    changesList.join('\n') + `\n\n<i>Vui lòng mở Mini App để xem toàn bộ lịch của tuần.</i>`;
                await bot.telegram.sendMessage(targetUser.telegram_id, notifyMsg, { parse_mode: 'HTML' });
            } catch (e) {
                console.error(`Không thể gửi thông báo thay đổi lịch cho user ${targetUser.telegram_id}:`, e);
            }
        }
    }

    syncSheets().catch(e => console.error('Sync sheet error:', e));
    return { ok: true, message: 'Lưu lịch tuần thành công!' };
}
