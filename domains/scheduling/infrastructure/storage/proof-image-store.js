/**
 * Lưu ảnh minh chứng báo bù xuống đĩa và trả về URL công khai.
 *
 * Ảnh gửi lên dạng base64 trong JSON (Mini App lịch khách không dùng multipart),
 * nên phải tự giải mã, tự kiểm định dạng rồi mới ghi file.
 */

import { MAX_PROOF_BYTES, SchedulingError } from '../../domain/makeup-rules.js';

/**
 * @param {object} deps
 * @param {Function} deps.isValidImage kiểm magic bytes, dùng lại của bot
 * @param {Function} deps.getImageExtension
 * @param {string} deps.uploadDir thư mục public/uploads
 * @param {string} deps.publicBaseUrl MINI_APP_URL
 */
export function createProofImageStore({ fs, path, isValidImage, getImageExtension, uploadDir, publicBaseUrl }) {
    /**
     * Giải mã và kiểm định ảnh. Ném lỗi TRƯỚC khi ghi đĩa để không để lại rác.
     * @returns {Buffer}
     */
    function decode(imageBase64) {
        const raw = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(raw, 'base64');

        if (buffer.length > MAX_PROOF_BYTES) {
            throw new SchedulingError(
                `Kích thước ảnh giải mã vượt quá giới hạn ${MAX_PROOF_BYTES / 1024 / 1024}MB!`);
        }
        if (!isValidImage(buffer)) {
            throw new SchedulingError(
                'Ảnh tải lên không đúng định dạng hình ảnh hợp lệ (chỉ chấp nhận JPEG, PNG, GIF, WebP)!');
        }
        return buffer;
    }

    /**
     * @returns {{filePath:string, proofUrl:string}}
     */
    function save(buffer, telegramId, timestamp = Date.now()) {
        const filename = `Makeup_${telegramId}_${timestamp}${getImageExtension(buffer)}`;
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

        const filePath = path.join(uploadDir, filename);
        fs.writeFileSync(filePath, buffer);

        return { filePath, proofUrl: `${publicBaseUrl}/mini-app/uploads/${filename}` };
    }

    /** Dọn ảnh khi transaction hỏng — tránh để lại file mồ côi trong uploads. */
    function remove(filePath) {
        if (!filePath || !fs.existsSync(filePath)) return;
        try {
            fs.unlinkSync(filePath);
        } catch (_) {
            // Xoá được thì tốt; không xoá được cũng không được làm hỏng luồng báo lỗi.
        }
    }

    return { decode, save, remove };
}
