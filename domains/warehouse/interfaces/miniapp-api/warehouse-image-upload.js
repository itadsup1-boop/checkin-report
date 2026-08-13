import fs from 'fs';
import path from 'path';
import multer from 'multer';

const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_COUNT = 6;

/**
 * Tạo middleware upload riêng của module kho.
 * Chỉ nhận ảnh và giữ nguyên giới hạn tương thích với Mini App hiện tại.
 */
export function createWarehouseImageReceiver({ uploadDir }) {
    if (!uploadDir) {
        throw new Error('warehouse uploadDir is required');
    }

    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdirSync(uploadDir, { recursive: true });
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname) || '.jpg';
            cb(null, `customer_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
        }
    });

    const uploadWarehouseImages = multer({
        storage,
        limits: {
            fileSize: MAX_IMAGE_SIZE_BYTES,
            files: MAX_IMAGE_COUNT
        },
        fileFilter: (req, file, cb) => {
            if (file.mimetype && file.mimetype.startsWith('image/')) {
                return cb(null, true);
            }
            return cb(new Error('Chức năng nhập kho chỉ nhận hình ảnh.'));
        }
    });

    return function receiveWarehouseImages(req, res, next) {
        uploadWarehouseImages.array('media_files', MAX_IMAGE_COUNT)(req, res, error => {
            if (!error) return next();

            const message = error.code === 'LIMIT_FILE_SIZE'
                ? 'Mỗi ảnh tải lên không được vượt quá 15 MB.'
                : error.code === 'LIMIT_FILE_COUNT'
                    ? 'Chỉ được gửi tối đa 6 ảnh chứng minh.'
                    : error.message;

            return res.status(400).json({ success: false, message });
        });
    };
}

export const WAREHOUSE_IMAGE_LIMITS = Object.freeze({
    maxBytesPerImage: MAX_IMAGE_SIZE_BYTES,
    maxImageCount: MAX_IMAGE_COUNT
});
