import path from 'node:path';
import multer from 'multer';
import {
    RETAIL_CONFIG,
    validateWorkingHours,
    calculateKpiProgress
} from '../../domain/checkin-rules.js';

import {
    buildSpamIntervalWarningMessage,
    buildDuplicatePhotoWarningMessage
} from '../../domain/retail-messages.js';

export function registerRetailMiniappRoutes({
    botApp,
    bot,
    repository,
    sheetSync,
    moment,
    crypto,
    fs,
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
        limits: { fileSize: 20 * 1024 * 1024, files: 5 }
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

            const now = moment().utcOffset(7);
            const dateStr = now.format('YYYY-MM-DD');
            const todayCheckins = await repository.findTodayCheckins(employee.id, dateStr);
            const todayValidCount = (todayCheckins || []).filter(c => c.is_valid !== false).length;
            const progress = calculateKpiProgress(todayValidCount);

            return res.json({
                ok: true,
                isRegistered: true,
                employee: {
                    id: employee.id,
                    fullName: employee.full_name,
                    role: employee.role
                },
                progress: {
                    todayCount: todayValidCount,
                    target: RETAIL_CONFIG.TARGET_POINTS_PER_DAY,
                    remaining: progress.remaining,
                    isCompleted: progress.completed
                }
            });
        } catch (error) {
            console.error('[Retail Bootstrap Error]:', error);
            return res.status(500).json({ ok: false, message: error.message });
        }
    });

    // 2. API Submit Check-in từ Mini App
    botApp.post(
        '/api/retail-checkin/submit',
        uploadRetail.fields([
            { name: 'photo_selfie', maxCount: 1 },
            { name: 'photo_store', maxCount: 1 }
        ]),
        async (req, res) => {
            const uploadedFiles = [];
            if (req.files?.photo_selfie) uploadedFiles.push(...req.files.photo_selfie);
            if (req.files?.photo_store) uploadedFiles.push(...req.files.photo_store);

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

                if (uploadedFiles.length < 2) {
                    cleanupFiles();
                    return res.status(400).json({ ok: false, message: 'Bắt buộc phải chụp đủ 2 ảnh (Ảnh selfie cổng và Ảnh quầy kệ bên trong)!' });
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

                // Kiểm tra khoảng cách chống spam (120s)
                const lastCheckin = await repository.findLastCheckin(employee.id);
                if (lastCheckin) {
                    const lastTime = moment(lastCheckin.checkin_time).utcOffset(7);
                    const diffSeconds = now.diff(lastTime, 'seconds');
                    if (diffSeconds < RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS) {
                        const waitRemaining = RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS - diffSeconds;
                        cleanupFiles();
                        return res.status(429).json({
                            ok: false,
                            message: `⚠️ Bạn vừa check-in cách đây chưa đầy 2 phút! Vui lòng đợi thêm ${waitRemaining} giây trước khi check-in điểm tiếp theo.`
                        });
                    }
                }

                // Tính chuỗi băm MD5 chống ảnh trùng
                const photoHashes = [];
                if (crypto) {
                    uploadedFiles.forEach(f => {
                        try {
                            const buffer = fs.readFileSync(f.path);
                            photoHashes.push(crypto.createHash('md5').update(buffer).digest('hex'));
                        } catch (_) {}
                    });

                    if (photoHashes.length > 0) {
                        const recentHashes = await repository.findRecentPhotoHashes(employee.id, 30);
                        const hasDuplicate = photoHashes.some(h => recentHashes.has(h));
                        if (hasDuplicate) {
                            cleanupFiles();
                            return res.status(400).json({
                                ok: false,
                                message: '⚠️ Ảnh bạn tải lên đã từng được dùng để check-in trước đó! Vui lòng chụp ảnh mới tại điểm bán.'
                            });
                        }
                    }
                }

                // Đếm số lượng điểm bán đã checkin trong ngày
                const todayCheckins = await repository.findTodayCheckins(employee.id, dateStr);
                const todayValidCount = (todayCheckins || []).filter(c => c.is_valid !== false).length;
                const newProgress = calculateKpiProgress(todayValidCount + 1);

                // Gửi ảnh kèm thông báo vào nhóm chat Telegram để Quản lý theo dõi
                let selfieFileId = null;
                let storePhotoFileId = null;

                try {
                    if (bot && bot.telegram) {
                        const selfieFile = uploadedFiles[0];
                        const storeFile = uploadedFiles[1];

                        const captionText = 
                            `📍 <b>XÁC NHẬN CHECK-IN ĐIỂM BÁN HỢP LỆ (QUA MINI APP)</b>\n\n` +
                            `👤 <b>Nhân viên:</b> ${employee.full_name}\n` +
                            `🏪 <b>Điểm bán:</b> ${storeName}\n` +
                            `📬 <b>Địa chỉ:</b> ${storeAddress}\n` +
                            `⏰ <b>Thời gian:</b> ${displayDateTime}\n\n` +
                            `🎯 <b>Tiến độ hôm nay:</b> ${todayValidCount + 1}/${RETAIL_CONFIG.TARGET_POINTS_PER_DAY} điểm\n` +
                            (newProgress.completed
                                ? `🎉 <i>Chúc mừng! Đã hoàn thành chỉ tiêu tối thiểu trong ngày!</i>`
                                : `⌛ Còn thiếu: <b>${newProgress.remaining} điểm</b> nữa để hoàn thành KPI.`) +
                            `\n\n<i>Hệ thống đã tự động ghi nhận và đồng bộ dữ liệu vào bảng theo dõi.</i>`;

                        const mediaGroup = [
                            {
                                type: 'photo',
                                media: { source: selfieFile.path },
                                caption: captionText,
                                parse_mode: 'HTML'
                            },
                            {
                                type: 'photo',
                                media: { source: storeFile.path }
                            }
                        ];

                        const sentMessages = await bot.telegram.sendMediaGroup(telegramGroupId, mediaGroup);
                        if (sentMessages && sentMessages.length >= 2) {
                            const p0 = sentMessages[0]?.photo;
                            const p1 = sentMessages[1]?.photo;
                            selfieFileId = p0 && p0.length > 0 ? p0[p0.length - 1].file_id : null;
                            storePhotoFileId = p1 && p1.length > 0 ? p1[p1.length - 1].file_id : null;
                        }
                    }
                } catch (sendErr) {
                    console.error('[Retail MiniApp Send Telegram Group Error]:', sendErr.message || sendErr);
                }

                // Ghi nhận vào cơ sở dữ liệu
                const checkinRecord = await repository.insertCheckin({
                    groupId: group.id,
                    employeeId: employee.id,
                    storeName,
                    storeAddress,
                    selfiePhotoUrl: selfieFileId || null,
                    storePhotoUrl: storePhotoFileId || null,
                    mediaUrls: [selfieFileId, storePhotoFileId].filter(Boolean),
                    checkinTime: now.toISOString(),
                    checkinDate: dateStr,
                    isValid: true,
                    rejectReason: null,
                    photoHashes
                });

                // Đồng bộ lên Google Sheets
                if (sheetSync && typeof sheetSync.syncCheckin === 'function') {
                    await sheetSync.syncCheckin(telegramGroupId, {
                        dateStr: now.format('DD/MM/YYYY'),
                        timeStr,
                        employeeName: employee.full_name,
                        storeName,
                        storeAddress,
                        progressStr: `${todayValidCount + 1}/${RETAIL_CONFIG.TARGET_POINTS_PER_DAY}`,
                        selfieUrl: selfieFileId || '',
                        storePhotoUrl: storePhotoFileId || '',
                        isValid: true,
                        rejectReason: ''
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
                        target: RETAIL_CONFIG.TARGET_POINTS_PER_DAY,
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
