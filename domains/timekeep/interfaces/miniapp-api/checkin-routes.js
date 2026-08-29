/**
 * Mini App điểm danh video.
 *
 * Hợp đồng tương thích — giữ nguyên đường dẫn và tên field multipart:
 * `POST /api/timekeep/checkin/save` (field `video_file`).
 */
export function registerCheckinRoutes({ botApp, multer, fs, path, uploadDir, saveCheckin }) {
    const checkinStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdirSync(uploadDir, { recursive: true });
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const telegramId = req.verifiedTelegramId || req.body.telegram_id || 'user';
            const ext = path.extname(file.originalname) || '.mp4';
            cb(null, `checkin_${telegramId}_${Date.now()}${ext}`);
        }
    });
    const uploadCheckin = multer({ storage: checkinStorage, limits: { fileSize: 200 * 1024 * 1024 } });

    botApp.post('/api/timekeep/checkin/save', uploadCheckin.single('video_file'), async (req, res) => {
        try {
            const result = await saveCheckin(req);
            if (!result.ok) {
                return res.status(result.status).json({ success: false, message: result.message });
            }

            res.json({ success: true, message: result.message });
            result.runBackgroundTask?.();
        } catch (error) {
            console.error('[Save Checkin Error]:', error);
            res.status(500).json({ success: false, message: 'Lỗi hệ thống: ' + error.message });
        }
    });
}
