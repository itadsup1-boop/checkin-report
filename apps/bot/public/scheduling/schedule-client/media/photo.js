/**
 * Thu nhỏ ảnh minh chứng thành chuỗi base64 để gửi kèm JSON.
 *
 * Bản cũ có ĐÚNG đoạn này lặp hai lần (tab Nhiệm vụ và tab Báo bù), khác nhau
 * mỗi mức nén 0.8 / 0.85 — nên gộp làm một và cho truyền mức nén vào.
 *
 * Vì sao là base64 chứ không phải FormData như nhập kho: hai endpoint
 * /api/upload-proof và /api/schedules/makeup nhận `imageBase64` trong JSON body.
 * Đổi cách gửi ở đây sẽ phải đổi cả server.
 */

export const MAX_WIDTH = 1200;

function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = () => reject(new Error('Không đọc được ảnh'));
        reader.readAsDataURL(file);
    });
}

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Ảnh không hợp lệ'));
        image.src = dataUrl;
    });
}

/**
 * @param {File} file
 * @param {number} quality 0..1 — Nhiệm vụ dùng 0.8, Báo bù dùng 0.85
 * @returns {Promise<string>} chuỗi data:image/jpeg;base64,…
 */
export async function toCompressedDataUrl(file, quality) {
    const image = await loadImage(await readAsDataUrl(file));

    // Chỉ thu nhỏ, không phóng to: ảnh nhỏ hơn 1200px giữ nguyên kích thước gốc.
    const scale = Math.min(1, MAX_WIDTH / image.width);

    const canvas = document.createElement('canvas');
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas.toDataURL('image/jpeg', quality);
}

export const TASK_PHOTO_QUALITY = 0.8;
export const MAKEUP_PHOTO_QUALITY = 0.85;
