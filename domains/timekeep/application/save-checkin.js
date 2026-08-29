/**
 * Điểm danh bằng video: lưu ngay vào `tk_check_ins` rồi trả kết quả cho Mini App
 * ngay lập tức, việc convert MP4 (nếu cần) và gửi video vào nhóm chạy nền phía
 * sau — không bắt nhân viên chờ ffmpeg xong mới đóng được Mini App.
 */
export function createSaveCheckin({
    checkinRepository, scheduleRepository, findEmployeeContext, isSystemAdmin,
    moment, fs, path, exec, bot, sendVideoToRoleGroup, uploadDir, syncSheets
}) {
    function decodeVideoFile(req) {
        if (req.file) {
            const originalUploadPath = req.file.path;
            const filename = req.file.filename;
            const ext = path.extname(filename).toLowerCase();
            const isMp4 = ['.mp4', '.mov', '.m4v'].includes(ext);
            return {
                videoUrl: `/mini-app/uploads/checkins/${filename}`,
                originalUploadPath,
                finalMp4Path: isMp4 ? originalUploadPath : originalUploadPath.replace(ext, '.mp4'),
                isMp4
            };
        }

        const { video_base64: videoBase64, mime_type: mimeType, telegram_id: telegramId } = req.body;
        if (!videoBase64 || !videoBase64.includes(';base64,')) return null;

        const base64Data = videoBase64.split(';base64,')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        let ext = 'webm';
        let isMp4 = false;
        if (mimeType) {
            const mimeLower = mimeType.toLowerCase();
            if (mimeLower.includes('mp4') || mimeLower.includes('quicktime') || mimeLower.includes('mov') || mimeLower.includes('m4v')) {
                ext = 'mp4'; isMp4 = true;
            } else if (mimeLower.includes('3gp')) ext = '3gp';
            else if (mimeLower.includes('avi')) ext = 'avi';
            else if (mimeLower.includes('webm')) ext = 'webm';
        }

        const filename = `checkin_${telegramId}_${Date.now()}.${ext}`;
        const originalUploadPath = path.join(uploadDir, filename);
        fs.mkdirSync(uploadDir, { recursive: true });
        fs.writeFileSync(originalUploadPath, buffer);

        return {
            videoUrl: `/mini-app/uploads/checkins/${filename}`,
            originalUploadPath,
            finalMp4Path: isMp4 ? originalUploadPath : originalUploadPath.replace('.webm', '.mp4'),
            isMp4
        };
    }

    async function convertAndSendVideo({ originalUploadPath, finalMp4Path, isMp4, telegramGroupId, user }) {
        if (!telegramGroupId || !originalUploadPath) return;

        const timestampStr = moment().format('HH:mm - DD/MM/YYYY');
        const caption = `📸 <b>BÁO CÁO ĐIỂM DANH</b>\n\n` +
            `👤 <b>Nhân viên:</b> ${user.full_name}\n` +
            `💼 <b>Vị trí:</b> ${user.role}\n` +
            `⏰ <b>Thời gian:</b> ${timestampStr}`;

        try {
            if (!isMp4) {
                await new Promise((resolve, reject) => {
                    exec(`ffmpeg -y -i "${originalUploadPath}" -c:v libx264 -preset fast -crf 28 "${finalMp4Path}"`, error => {
                        if (error) reject(error); else resolve();
                    });
                });
            }
            await sendVideoToRoleGroup(bot, telegramGroupId, 'timekeep', { source: finalMp4Path }, { caption, parse_mode: 'HTML' }, 'checkin_video');
        } catch (err) {
            console.error('[Send Checkin Video Error]:', err);
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

        const video = decodeVideoFile(req);
        if (!video) {
            return { ok: false, status: 400, message: 'Thiếu dữ liệu video tải lên!' };
        }

        const currentDate = moment().utcOffset(7).format('YYYY-MM-DD');
        const checkInTime = moment().utcOffset(7).format('YYYY-MM-DD HH:mm:ss');
        await checkinRepository.insertCheckIn({ groupId, userId: user.id, date: currentDate, checkInTime, videoUrl: video.videoUrl });
        syncSheets().catch(e => console.error('Sheet sync error:', e));

        return {
            ok: true,
            message: 'Điểm danh thành công!',
            runBackgroundTask: () => convertAndSendVideo({ ...video, telegramGroupId, user })
        };
    }

    return { saveCheckin };
}
