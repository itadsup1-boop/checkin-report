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
    buildSpamIntervalWarningMessage
} from '../domain/retail-messages.js';

export function createProcessStoreCheckin({ repository, sheetSync, moment, bot, uploadToDrive, getOrCreateRetailFolderHierarchy }) {
    return async function processStoreCheckin({
        telegramId,
        telegramGroupId,
        caption,
        photos = [],
        photoHashes = [],
        latitude = null,
        longitude = null,
        locationAccuracy = null,
        googleMapsUrl = null
    }) {
        const computedMapsUrl = googleMapsUrl || (latitude && longitude ? `https://maps.google.com/?q=${latitude},${longitude}` : null);
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

        // 2b. Kiểm tra ngày làm việc (T2 - T7) và khung giờ làm việc
        const hourCheck = validateWorkingHours(now, group.shift_start_time, group.shift_end_time);
        if (!hourCheck.isWorkingHour) {
            await repository.insertCheckin({
                groupId: group.id,
                employeeId: employee.id,
                storeName: 'Ngoài giờ / Ngày nghỉ',
                storeAddress: caption || '',
                checkinTime: now.toISOString(),
                checkinDate: dateStr,
                isValid: false,
                rejectReason: hourCheck.message
            });

            return {
                success: false,
                replyText: buildCheckinErrorMessage({
                    employeeName: employee.full_name,
                    reason: hourCheck.message,
                    formatHelp: false
                })
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
                rejectReason: 'Thiếu ảnh minh chứng (cần ít nhất 1 ảnh)'
            });

            return {
                success: false,
                replyText: buildCheckinErrorMessage({
                    employeeName: employee.full_name,
                    reason: 'Mỗi lượt check-in bắt buộc gửi kèm ít nhất <b>01 ảnh</b> minh chứng điểm bán.'
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

        // 5. Kiểm tra khoảng cách gửi liên tiếp (chống spam/gửi dồn) - Bỏ qua nếu cấu hình <= 0
        if (RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS > 0) {
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
        }

        // 6. Kiểm tra trùng lặp ảnh cũ: Đã tắt theo yêu cầu

        // 7. Ghi nhận lượt check-in hợp lệ & Tải ảnh lên Google Drive nếu có cấu hình thư mục
        const driveFolderId = group.customer_drive_folder_id || group.warehouse_drive_folder_id || process.env.RETAIL_CHECKIN_DRIVE_FOLDER_ID;
        let selfieDriveUrl = null;
        let storeDriveUrls = [];

        let dailyDriveFolderUrl = null;
        if (uploadToDrive && driveFolderId && bot?.telegram && photos.length > 0) {
            try {
                let targetFolderId = driveFolderId;
                if (typeof getOrCreateRetailFolderHierarchy === 'function') {
                    try {
                        const empFolder = await getOrCreateRetailFolderHierarchy(
                            driveFolderId,
                            now.format('DD-MM-YYYY'),
                            employee.full_name
                        );
                        if (empFolder?.id) {
                            targetFolderId = empFolder.id;
                        }
                        if (empFolder?.webViewLink) {
                            dailyDriveFolderUrl = empFolder.webViewLink;
                        }
                    } catch (fErr) {
                        console.error('[Retail Drive Hierarchy Error in Chat]:', fErr.message);
                    }
                }

                for (let i = 0; i < photos.length; i++) {
                    const p = photos[i];
                    if (!p?.file_id) continue;
                    const link = await bot.telegram.getFileLink(p.file_id);
                    const res = await fetch(link.href);
                    if (res.ok) {
                        const buffer = Buffer.from(await res.arrayBuffer());
                        const prefix = i === 0 ? 'Selfie' : `QuayKe_${i}`;
                        const fileName = `${prefix}_${employee.full_name}_${dateStr}_${Date.now()}.jpg`;
                        const uploaded = await uploadToDrive(buffer, fileName, 'image/jpeg', targetFolderId);
                        if (uploaded?.webViewLink) {
                            if (i === 0) {
                                selfieDriveUrl = uploaded.webViewLink;
                            } else {
                                storeDriveUrls.push(uploaded.webViewLink);
                            }
                        }
                    }
                }
            } catch (driveErr) {
                console.error('[Retail Drive Upload Error in Chat]:', driveErr.message);
            }
        }

        const selfieUrl = selfieDriveUrl || photos[0]?.file_id || null;
        const storePhotoUrl = storeDriveUrls.length > 0 ? storeDriveUrls.join(', ') : (photos[1]?.file_id || null);
        const mediaUrls = (selfieDriveUrl || storeDriveUrls.length > 0)
            ? [selfieDriveUrl, ...storeDriveUrls].filter(Boolean)
            : photos.map(p => p.file_id);

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
            photoHashes,
            driveFolderUrl: dailyDriveFolderUrl,
            latitude,
            longitude,
            locationAccuracy,
            googleMapsUrl: computedMapsUrl
        });

        // 8. Đếm số lượng điểm bán hợp lệ hôm nay & cập nhật tiến độ KPI
        const kpiTarget = Number(group.daily_kpi_target) || RETAIL_CONFIG.TARGET_POINTS_PER_DAY;
        const validCount = await repository.countDailyValidCheckins(employee.id, dateStr, group.id);
        const progress = calculateKpiProgress(validCount, kpiTarget);

        await repository.upsertDailySummary({
            groupId: group.id,
            employeeId: employee.id,
            recordDate: dateStr,
            validPointsCount: validCount,
            targetPoints: kpiTarget,
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
            isValid: true,
            isOvertime: hourCheck?.isOvertime || false,
            latitude,
            longitude,
            locationAccuracy,
            googleMapsUrl: computedMapsUrl
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
                targetPoints: kpiTarget,
                remainingPoints: progress.remaining,
                completed: progress.completed
            })
        };
    };
}
