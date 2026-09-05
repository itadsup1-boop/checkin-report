import {
    RETAIL_CONFIG,
    parseCheckinCaption,
    validateCheckinPhotos,
    validateWorkingHours,
    calculateKpiProgress
} from '../domain/checkin-rules.js';

import {
    buildCheckinSuccessMessage,
    buildCheckinErrorMessage,
    buildSpamIntervalWarningMessage,
    buildDuplicatePhotoWarningMessage
} from '../domain/retail-messages.js';

export function createProcessStoreCheckin({ repository, sheetSync, moment }) {
    return async function processStoreCheckin({
        telegramId,
        telegramGroupId,
        caption,
        photos = [],
        photoHashes = []
    }) {
        const now = moment().utcOffset(7);
        const dateStr = now.format('YYYY-MM-DD');
        const timeStr = now.format('HH:mm:ss');
        const displayDateTime = now.format('HH:mm:ss - DD/MM/YYYY');

        // 1. Kiểm tra danh tính nhân viên
        const employee = await repository.findEmployeeByTelegramId(telegramId);
        if (!employee) {
            return {
                success: false,
                replyText: `⚠️ <b>Tài khoản chưa đăng ký!</b>\nVui lòng đăng ký nhân sự bằng cú pháp <code>/setup Họ và Tên</code> trước khi thực hiện check-in điểm bán.`
            };
        }

        // 2. Kiểm tra thông tin nhóm
        const group = await repository.findGroupByTelegramId(telegramGroupId);
        if (!group) {
            return {
                success: false,
                replyText: `⚠️ Nhóm làm việc này chưa được cấu hình trên hệ thống quản lý.`
            };
        }

        // 3. Kiểm tra số lượng ảnh
        const photoCheck = validateCheckinPhotos(photos.length);
        if (!photoCheck.valid) {
            await repository.insertCheckin({
                groupId: group.id,
                employeeId: employee.id,
                storeName: 'Không xác định (Thiếu ảnh)',
                storeAddress: caption || '',
                checkinTime: now.toISOString(),
                checkinDate: dateStr,
                isValid: false,
                rejectReason: 'Thiếu ảnh minh chứng (cần ít nhất 2 ảnh)'
            });

            return {
                success: false,
                replyText: buildCheckinErrorMessage({
                    employeeName: employee.full_name,
                    reason: 'Mỗi lượt check-in bắt buộc gửi kèm ít nhất <b>02 ảnh</b> (01 ảnh selfie tại cổng/biển hiệu + 01 ảnh quầy sản phẩm bên trong).'
                })
            };
        }

        // 4. Bóc tách cú pháp
        const parsed = parseCheckinCaption(caption);
        if (!parsed) {
            await repository.insertCheckin({
                groupId: group.id,
                employeeId: employee.id,
                storeName: 'Sai cú pháp',
                storeAddress: caption || '',
                checkinTime: now.toISOString(),
                checkinDate: dateStr,
                isValid: false,
                rejectReason: 'Sai định dạng cú pháp [Tên điểm bán] - [Địa chỉ]'
            });

            return {
                success: false,
                replyText: buildCheckinErrorMessage({
                    employeeName: employee.full_name,
                    reason: 'Tin nhắn chưa đúng định dạng hoặc thiếu dấu gạch nối <code>-</code> giữa tên cửa hàng và địa chỉ.'
                })
            };
        }

        // 5. Kiểm tra khoảng cách gửi liên tiếp (chống spam/gửi dồn)
        const lastCheckin = await repository.findLastCheckin(employee.id);
        if (lastCheckin) {
            const lastTime = moment(lastCheckin.checkin_time).utcOffset(7);
            const diffSeconds = now.diff(lastTime, 'seconds');
            if (diffSeconds < RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS) {
                const waitRemaining = RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS - diffSeconds;
                return {
                    success: false,
                    replyText: buildSpamIntervalWarningMessage({
                        employeeName: employee.full_name,
                        waitSeconds: waitRemaining
                    })
                };
            }
        }

        // 6. Kiểm tra trùng lặp ảnh cũ
        if (photoHashes.length > 0) {
            const recentHashes = await repository.findRecentPhotoHashes(employee.id, 30);
            const hasDuplicate = photoHashes.some(h => recentHashes.has(h));
            if (hasDuplicate) {
                return {
                    success: false,
                    replyText: buildDuplicatePhotoWarningMessage({
                        employeeName: employee.full_name
                    })
                };
            }
        }

        // 7. Ghi nhận lượt check-in hợp lệ vào Database
        const selfieUrl = photos[0]?.file_id || null;
        const storePhotoUrl = photos[1]?.file_id || null;
        const mediaUrls = photos.map(p => p.file_id);

        await repository.insertCheckin({
            groupId: group.id,
            employeeId: employee.id,
            storeName: parsed.storeName,
            storeAddress: parsed.storeAddress,
            selfiePhotoUrl: selfieUrl,
            storePhotoUrl: storePhotoUrl,
            mediaUrls,
            checkinTime: now.toISOString(),
            checkinDate: dateStr,
            isValid: true,
            rejectReason: null,
            photoHashes
        });

        // 8. Đếm số lượng điểm bán hợp lệ hôm nay & cập nhật tiến độ KPI
        const validCount = await repository.countDailyValidCheckins(employee.id, dateStr, group.id);
        const progress = calculateKpiProgress(validCount);

        await repository.upsertDailySummary({
            groupId: group.id,
            employeeId: employee.id,
            recordDate: dateStr,
            validPointsCount: validCount,
            targetPoints: RETAIL_CONFIG.TARGET_POINTS_PER_DAY,
            isCompleted: progress.completed,
            status: progress.completed ? 'COMPLETED' : 'INCOMPLETE'
        });

        // 9. Đồng bộ dữ liệu sang Google Sheet (chạy nền không chặn bot)
        sheetSync.syncCheckin(telegramGroupId, {
            dateStr: now.format('DD/MM/YYYY'),
            timeStr,
            employeeName: employee.full_name,
            storeName: parsed.storeName,
            storeAddress: parsed.storeAddress,
            progressStr: progress.progressText,
            selfieUrl,
            storePhotoUrl,
            isValid: true
        }).catch(err => {
            console.error('[Retail Checkin Sheet Sync Error]:', err);
        });

        // 10. Trả tin nhắn chúc mừng/tiến độ
        return {
            success: true,
            replyText: buildCheckinSuccessMessage({
                employeeName: employee.full_name,
                storeName: parsed.storeName,
                storeAddress: parsed.storeAddress,
                timeStr: displayDateTime,
                currentPoints: validCount,
                targetPoints: RETAIL_CONFIG.TARGET_POINTS_PER_DAY,
                remainingPoints: progress.remaining,
                completed: progress.completed
            })
        };
    };
}
