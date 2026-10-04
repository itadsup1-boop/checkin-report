import path from 'node:path';
import multer from 'multer';
import {
    RETAIL_CONFIG,
    validateWorkingHours,
    calculateKpiProgress
} from '../../domain/checkin-rules.js';

import {
    buildSpamIntervalWarningMessage
} from '../../domain/retail-messages.js';

export function registerRetailMiniappRoutes({
    botApp,
    bot,
    repository,
    sheetSync,
    moment,
    crypto,
    fs,
    uploadToDrive,
    getOrCreateRetailFolderHierarchy,
    retailUploadDir,
    authenticateTelegramMiniApp
}) {
    if (!botApp) return;

    const uploadDir = retailUploadDir || path.join(process.cwd(), 'apps/bot/public/uploads/retail');
    try {
        if (fs && !fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
    } catch (e) {
        console.warn('[Retail Miniapp] Không thể tạo thư mục upload:', e.message);
    }

    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname) || '.jpg';
            cb(null, `retail_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
        }
    });

    const uploadRetail = multer({
        storage,
        limits: { fileSize: 30 * 1024 * 1024, files: 35 }
    });

    // 1. API Bootstrap / Lấy thông tin tiến độ hiện tại của nhân viên
    botApp.get('/api/retail-checkin/bootstrap', async (req, res) => {
        try {
            const telegramId = req.query.telegram_id || req.verifiedTelegramId;
            const telegramGroupId = req.query.chat_id || req.query.telegram_group_id;

            if (!telegramId || !telegramGroupId) {
                return res.status(400).json({ ok: false, message: 'Thiếu thông tin telegram_id hoặc chat_id' });
            }

            const employee = await repository.findEmployeeByTelegramId(telegramId);
            if (!employee) {
                return res.status(403).json({
                    ok: false,
                    isRegistered: false,
                    message: 'Tài khoản chưa được kích hoạt hoặc chưa được Admin duyệt.'
                });
            }

            const group = typeof repository.findGroupByTelegramId === 'function' 
                ? await repository.findGroupByTelegramId(telegramGroupId) 
                : null;
            const kpiTarget = Number(group?.daily_kpi_target) || RETAIL_CONFIG.TARGET_POINTS_PER_DAY;

            const now = moment().utcOffset(7);
            const dateStr = now.format('YYYY-MM-DD');
            const todayCheckins = await repository.findTodayCheckins(employee.id, dateStr);
            const todayValidCount = (todayCheckins || []).filter(c => c.is_valid !== false).length;
            const progress = calculateKpiProgress(todayValidCount, kpiTarget);
            const hourCheck = validateWorkingHours(now, group?.shift_start_time, group?.shift_end_time);

            return res.json({
                ok: true,
                isRegistered: true,
                workingHours: {
                    isWorkingHour: hourCheck.isWorkingHour,
                    isLunchBreak: hourCheck.isLunchBreak,
                    isCutoff: hourCheck.isCutoff || false,
                    isOvertime: hourCheck.isOvertime || false,
                    message: hourCheck.message,
                    shiftStart: (group?.shift_start_time || RETAIL_CONFIG.SHIFT_START).slice(0, 5),
                    shiftEnd: (group?.shift_end_time || RETAIL_CONFIG.SHIFT_END).slice(0, 5),
                    cutoffTime: RETAIL_CONFIG.CUTOFF_TIME
                },
                employee: {
                    id: employee.id,
                    fullName: employee.full_name,
                    role: employee.role
                },
                progress: {
                    todayCount: todayValidCount,
                    target: kpiTarget,
                    remaining: progress.remaining,
                    isCompleted: progress.completed
                }
            });
        } catch (error) {
            console.error('[Retail Bootstrap Error]:', error);
            return res.status(500).json({ ok: false, message: error.message });
        }
    });

    // 2. API Lịch sử check-in theo ngày (hôm nay hoặc ngày trong quá khứ)
    botApp.get('/api/retail-checkin/history', async (req, res) => {
        try {
            const telegramId = req.query.telegram_id || req.verifiedTelegramId;
            const telegramGroupId = req.query.chat_id || req.query.telegram_group_id;

            if (!telegramId || !telegramGroupId) {
                return res.status(400).json({ ok: false, message: 'Thiếu thông tin telegram_id hoặc chat_id' });
            }

            const employee = await repository.findEmployeeByTelegramId(telegramId);
            if (!employee) {
                return res.status(403).json({
                    ok: false,
                    message: 'Không tìm thấy thông tin nhân viên hoặc tài khoản chưa kích hoạt.'
                });
            }

            const group = typeof repository.findGroupByTelegramId === 'function'
                ? await repository.findGroupByTelegramId(telegramGroupId)
                : null;
            const kpiTarget = Number(group?.daily_kpi_target) || RETAIL_CONFIG.TARGET_POINTS_PER_DAY;

            // Xác định ngày cần tra cứu (mặc định hôm nay theo giờ VN UTC+7)
            let targetMoment;
            if (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date.trim())) {
                targetMoment = moment(req.query.date.trim(), 'YYYY-MM-DD').utcOffset(7);
            } else {
                targetMoment = moment().utcOffset(7);
            }

            const dateStr = targetMoment.format('YYYY-MM-DD');
            const checkins = await repository.findTodayCheckins(employee.id, dateStr, group?.id);
            const validCount = (checkins || []).filter(c => c.is_valid !== false).length;
            const progress = calculateKpiProgress(validCount, kpiTarget);

            let summary = null;
            if (typeof repository.findDailySummary === 'function') {
                summary = await repository.findDailySummary(employee.id, dateStr, group?.id);
            }

            const formattedCheckins = (checkins || []).map((c, index) => {
                let mediaList = [];
                if (Array.isArray(c.media_urls)) {
                    mediaList = c.media_urls;
                } else if (typeof c.media_urls === 'string') {
                    try {
                        mediaList = JSON.parse(c.media_urls || '[]');
                    } catch (_) {
                        mediaList = [];
                    }
                }

                // Tách ảnh quầy kệ nếu lưu dạng chuỗi phân cách bởi dấu phẩy
                let storePhotos = [];
                if (c.store_photo_url) {
                    storePhotos = c.store_photo_url.split(',').map(s => s.trim()).filter(Boolean);
                }

                return {
                    id: c.id,
                    orderNumber: (checkins.length - index), // Thứ tự từ cũ tới mới
                    storeName: c.store_name,
                    storeAddress: c.store_address,
                    checkinTime: c.checkin_time,
                    timeFormatted: moment(c.checkin_time).utcOffset(7).format('HH:mm:ss'),
                    selfieUrl: c.selfie_photo_url,
                    storePhotoUrl: c.store_photo_url,
                    storePhotos,
                    mediaUrls: mediaList,
                    isValid: c.is_valid !== false,
                    rejectReason: c.reject_reason || null,
                    latitude: c.latitude ? Number(c.latitude) : null,
                    longitude: c.longitude ? Number(c.longitude) : null,
                    locationAccuracy: c.location_accuracy ? Number(c.location_accuracy) : null,
                    googleMapsUrl: c.google_maps_url || (c.latitude && c.longitude ? `https://maps.google.com/?q=${c.latitude},${c.longitude}` : null)
                };
            });

            return res.json({
                ok: true,
                date: dateStr,
                displayDate: targetMoment.format('DD/MM/YYYY'),
                employee: {
                    id: employee.id,
                    fullName: employee.full_name,
                    role: employee.role
                },
                summary: {
                    totalCount: checkins.length,
                    validCount,
                    target: kpiTarget,
                    remaining: progress.remaining,
                    isCompleted: summary ? summary.is_completed : progress.completed,
                    progressPercent: Math.min(100, Math.round((validCount / kpiTarget) * 100)),
                    status: summary?.status || (progress.completed ? 'COMPLETED' : 'INCOMPLETE')
                },
                checkins: formattedCheckins
            });
        } catch (error) {
            console.error('[Retail History Error]:', error);
            return res.status(500).json({ ok: false, message: error.message });
        }
    });

    // 3. API Submit Check-in từ Mini App
    botApp.post(
        '/api/retail-checkin/submit',
        uploadRetail.fields([
            { name: 'photo_selfie', maxCount: 1 },
            { name: 'photo_store', maxCount: 30 }
        ]),
        async (req, res) => {
            const uploadedFiles = [];
            const selfieFiles = req.files?.photo_selfie || [];
            const storeFiles = req.files?.photo_store || [];
            uploadedFiles.push(...selfieFiles, ...storeFiles);

            const cleanupFiles = () => {
                uploadedFiles.forEach(f => {
                    try {
                        if (fs && fs.existsSync(f.path)) fs.unlinkSync(f.path);
                    } catch (_) {}
                });
            };

            try {
                const telegramId = req.body.telegram_id || req.verifiedTelegramId;
                const telegramGroupId = req.body.telegram_group_id || req.body.chat_id;
                const storeName = (req.body.store_name || '').trim();
                const storeAddress = (req.body.store_address || '').trim();
                const latitude = (req.body.latitude !== undefined && req.body.latitude !== null && req.body.latitude !== '') ? parseFloat(req.body.latitude) : null;
                const longitude = (req.body.longitude !== undefined && req.body.longitude !== null && req.body.longitude !== '') ? parseFloat(req.body.longitude) : null;
                const locationAccuracy = (req.body.location_accuracy !== undefined && req.body.location_accuracy !== null && req.body.location_accuracy !== '') ? parseFloat(req.body.location_accuracy) : null;
                const googleMapsUrl = (latitude !== null && !isNaN(latitude) && longitude !== null && !isNaN(longitude)) ? `https://maps.google.com/?q=${latitude},${longitude}` : null;

                if (!telegramId || !telegramGroupId) {
                    cleanupFiles();
                    return res.status(400).json({ ok: false, message: 'Thiếu thông tin nhóm làm việc hoặc tài khoản người gửi.' });
                }

                if (!storeName || storeName.length < 2) {
                    cleanupFiles();
                    return res.status(400).json({ ok: false, message: 'Vui lòng nhập tên điểm bán / cửa hàng hợp lệ!' });
                }

                if (!storeAddress || storeAddress.length < 2) {
                    cleanupFiles();
                    return res.status(400).json({ ok: false, message: 'Vui lòng nhập địa chỉ chi tiết của điểm bán!' });
                }

                if (uploadedFiles.length < 1) {
                    cleanupFiles();
                    return res.status(400).json({
                        ok: false,
                        message: 'Bắt buộc phải có ít nhất 1 ảnh minh chứng điểm bán!'
                    });
                }

                const employee = await repository.findEmployeeByTelegramId(telegramId);
                if (!employee) {
                    cleanupFiles();
                    return res.status(403).json({ ok: false, message: 'Tài khoản nhân sự chưa được duyệt trên hệ thống.' });
                }

                const group = await repository.findGroupByTelegramId(telegramGroupId);
                if (!group) {
                    cleanupFiles();
                    return res.status(404).json({ ok: false, message: 'Nhóm làm việc chưa được kích hoạt trên hệ thống.' });
                }

                const now = moment().utcOffset(7);
                const dateStr = now.format('YYYY-MM-DD');
                const timeStr = now.format('HH:mm:ss');
                const displayDateTime = now.format('HH:mm:ss - DD/MM/YYYY');

                // Kiểm tra khung giờ và ngày làm việc (T2 - T7)
                const hourCheck = validateWorkingHours(now, group.shift_start_time, group.shift_end_time);
                if (!hourCheck.isWorkingHour) {
                    cleanupFiles();
                    return res.status(400).json({
                        ok: false,
                        message: `Không thể check-in: ${hourCheck.message}`
                    });
                }

                // Kiểm tra khoảng cách chống spam (nếu có cấu hình > 0)
                if (RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS > 0) {
                    const lastCheckin = await repository.findLastCheckin(employee.id);
                    if (lastCheckin) {
                        const lastTime = moment(lastCheckin.checkin_time).utcOffset(7);
                        const diffSeconds = now.diff(lastTime, 'seconds');
                        if (diffSeconds < RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS) {
                            const waitRemaining = RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS - diffSeconds;
                            cleanupFiles();
                            return res.status(429).json({
                                ok: false,
                                message: `Bạn vừa check-in cách đây chưa đầy ${RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS} giây! Vui lòng đợi thêm ${waitRemaining} giây trước khi check-in điểm tiếp theo.`
                            });
                        }
                    }
                }

                // Kiểm tra trùng lặp ảnh cũ: Đã tắt theo yêu cầu
                const photoHashes = [];

                // Đếm số lượng điểm bán đã checkin trong ngày
                const kpiTarget = Number(group.daily_kpi_target) || RETAIL_CONFIG.TARGET_POINTS_PER_DAY;
                const todayCheckins = await repository.findTodayCheckins(employee.id, dateStr);
                const todayValidCount = (todayCheckins || []).filter(c => c.is_valid !== false).length;
                const newProgress = calculateKpiProgress(todayValidCount + 1, kpiTarget);

                // Gửi ảnh kèm thông báo vào nhóm chat Telegram để Quản lý theo dõi
                const allSentFileIds = [];
                try {
                    if (bot && bot.telegram && uploadedFiles.length > 0) {
                        let photoDesc = `${uploadedFiles.length} ảnh minh chứng`;
                        if (selfieFiles.length > 0 && storeFiles.length > 0) {
                            photoDesc = `1 ảnh cổng + ${storeFiles.length} ảnh quầy kệ (${uploadedFiles.length} ảnh)`;
                        } else if (selfieFiles.length > 0) {
                            photoDesc = `1 ảnh selfie cổng/biển hiệu`;
                        } else if (storeFiles.length > 0) {
                            photoDesc = `${storeFiles.length} ảnh quầy kệ`;
                        }

                        let locationDesc = '';
                        if (googleMapsUrl) {
                            const accStr = locationAccuracy ? ` (±${Math.round(locationAccuracy)}m)` : '';
                            locationDesc = `📍 <b>Định vị GPS:</b> <a href="${googleMapsUrl}">Xem trên Google Maps</a>${accStr}\n`;
                        }

                        const captionText = 
                            `📍 <b>XÁC NHẬN CHECK-IN ĐIỂM BÁN HỢP LỆ (QUA MINI APP)</b>\n\n` +
                            `👤 <b>Nhân viên:</b> ${employee.full_name}\n` +
                            `🏪 <b>Điểm bán:</b> ${storeName}\n` +
                            `📬 <b>Địa chỉ:</b> ${storeAddress}\n` +
                            locationDesc +
                            `📸 <b>Minh chứng:</b> ${photoDesc}\n` +
                            `⏰ <b>Thời gian:</b> ${displayDateTime}\n\n` +
                            `🎯 <b>Tiến độ hôm nay:</b> ${todayValidCount + 1}/${kpiTarget} điểm\n` +
                            (newProgress.completed
                                ? `🎉 <i>Chúc mừng! Đã hoàn thành chỉ tiêu tối thiểu trong ngày!</i>`
                                : `⌛ Còn thiếu: <b>${newProgress.remaining} điểm</b> nữa để hoàn thành KPI.`) +
                            `\n\n<i>Hệ thống đã tự động ghi nhận và đồng bộ dữ liệu vào bảng theo dõi.</i>`;

                        // Cắt thành các nhóm tối đa 10 ảnh (theo giới hạn media group của Telegram)
                        const chunks = [];
                        for (let i = 0; i < uploadedFiles.length; i += 10) {
                            chunks.push(uploadedFiles.slice(i, i + 10));
                        }

                        for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
                            const chunk = chunks[cIdx];
                            const mediaGroup = chunk.map((file, fIdx) => ({
                                type: 'photo',
                                media: { source: file.path },
                                ...(cIdx === 0 && fIdx === 0 ? { caption: captionText, parse_mode: 'HTML' } : {})
                            }));

                            const sentMessages = await bot.telegram.sendMediaGroup(telegramGroupId, mediaGroup);
                            if (sentMessages && Array.isArray(sentMessages)) {
                                sentMessages.forEach(msg => {
                                    const p = msg?.photo;
                                    if (p && p.length > 0) {
                                        allSentFileIds.push(p[p.length - 1].file_id);
                                    }
                                });
                            }
                        }
                    }
                } catch (sendErr) {
                    console.error('[Retail MiniApp Send Telegram Group Error]:', sendErr.message || sendErr);
                }

                // Tải ảnh lên Google Drive nếu nhóm có cấu hình thư mục
                const driveFolderId = group.customer_drive_folder_id || group.warehouse_drive_folder_id || process.env.RETAIL_CHECKIN_DRIVE_FOLDER_ID;
                let selfieDriveUrl = null;
                let storeDriveUrls = [];

                let dailyDriveFolderUrl = null;
                if (uploadToDrive && driveFolderId && uploadedFiles.length > 0) {
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
                                console.error('[Retail MiniApp Drive Hierarchy Error]:', fErr.message);
                            }
                        }

                        if (selfieFiles.length > 0) {
                            const sf = selfieFiles[0];
                            if (fs && fs.existsSync(sf.path)) {
                                const buffer = fs.readFileSync(sf.path);
                                const fileName = `Selfie_${employee.full_name}_${dateStr}_${Date.now()}.jpg`;
                                const uploaded = await uploadToDrive(buffer, fileName, 'image/jpeg', targetFolderId);
                                if (uploaded?.webViewLink) selfieDriveUrl = uploaded.webViewLink;
                            }
                        }
                        if (storeFiles.length > 0) {
                            for (let i = 0; i < storeFiles.length; i++) {
                                const stf = storeFiles[i];
                                if (fs && fs.existsSync(stf.path)) {
                                    const buffer = fs.readFileSync(stf.path);
                                    const fileName = `QuayKe_${employee.full_name}_${dateStr}_${i + 1}_${Date.now()}.jpg`;
                                    const uploaded = await uploadToDrive(buffer, fileName, 'image/jpeg', targetFolderId);
                                    if (uploaded?.webViewLink) storeDriveUrls.push(uploaded.webViewLink);
                                }
                            }
                        }
                    } catch (driveErr) {
                        console.error('[Retail Miniapp Drive Upload Error]:', driveErr.message || driveErr);
                    }
                }

                const selfieUrl = selfieDriveUrl || allSentFileIds[0] || null;
                const storePhotoPrimary = storeDriveUrls[0] || allSentFileIds[1] || null;
                const storePhotoUrlsAll = storeDriveUrls.length > 0 ? storeDriveUrls.join(', ') : (allSentFileIds.slice(1).join(', ') || null);
                const mediaUrls = (selfieDriveUrl || storeDriveUrls.length > 0)
                    ? [selfieDriveUrl, ...storeDriveUrls].filter(Boolean)
                    : allSentFileIds;

                // Ghi nhận vào cơ sở dữ liệu
                const checkinRecord = await repository.insertCheckin({
                    groupId: group.id,
                    employeeId: employee.id,
                    storeName,
                    storeAddress,
                    selfiePhotoUrl: selfieUrl,
                    storePhotoUrl: storePhotoPrimary,
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
                    googleMapsUrl
                });

                // Cập nhật bảng tổng kết tiến độ ngày
                if (typeof repository.upsertDailySummary === 'function') {
                    await repository.upsertDailySummary({
                        groupId: group.id,
                        employeeId: employee.id,
                        recordDate: dateStr,
                        validPointsCount: todayValidCount + 1,
                        targetPoints: kpiTarget,
                        isCompleted: newProgress.completed,
                        status: newProgress.completed ? 'COMPLETED' : 'INCOMPLETE'
                    });
                }

                // Đồng bộ lên Google Sheets
                if (sheetSync && typeof sheetSync.syncCheckin === 'function') {
                    await sheetSync.syncCheckin(telegramGroupId, {
                        dateStr: now.format('DD/MM/YYYY'),
                        timeStr,
                        employeeName: employee.full_name,
                        storeName,
                        storeAddress,
                        progressStr: `${todayValidCount + 1}/${kpiTarget}`,
                        selfieUrl: selfieUrl || '',
                        storePhotoUrl: storePhotoUrlsAll || '',
                        isValid: true,
                        isOvertime: hourCheck?.isOvertime || false,
                        rejectReason: '',
                        latitude,
                        longitude,
                        locationAccuracy,
                        googleMapsUrl
                    });
                }

                cleanupFiles();

                return res.json({
                    ok: true,
                    success: true,
                    message: `Check-in thành công điểm bán ${storeName}!`,
                    store: {
                        name: storeName,
                        address: storeAddress,
                        time: displayDateTime
                    },
                    progress: {
                        todayCount: todayValidCount + 1,
                        target: kpiTarget,
                        remaining: newProgress.remaining,
                        isCompleted: newProgress.completed
                    }
                });
            } catch (error) {
                cleanupFiles();
                console.error('[Retail Miniapp Submit Error]:', error);
                return res.status(500).json({ ok: false, message: 'Lỗi máy chủ khi xử lý check-in: ' + error.message });
            }
        }
    );
}
