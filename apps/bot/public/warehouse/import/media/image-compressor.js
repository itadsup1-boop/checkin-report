/**
 * Nén ảnh minh chứng trước khi tải lên.
 *
 * Vì sao phải nén: ảnh gốc từ điện thoại thường 3–8MB. Nhân sự chụp 6 ảnh là
 * ~30MB, qua 3G ở phòng khám thì quá 60 giây timeout và phiếu nhập bị treo. Nén
 * xuống ~350KB/ảnh vẫn đọc rõ chữ trên hộp thuốc — đủ để làm minh chứng.
 *
 * Thuần thao tác trình duyệt: không biết gì về nhập kho, không gọi API.
 * Thuật toán giữ nguyên như bản cũ (đã chạy thật), chỉ tách file.
 */

export const IMAGE_TARGET_MAX_BYTES = 350 * 1024;
export const IMAGE_MAX_DIMENSION = 1280;
const MAX_ATTEMPTS = 12;

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('Không thể nén ảnh'))), type, quality);
    });
}

async function loadImageSource(file) {
    if ('createImageBitmap' in globalThis) {
        try {
            // imageOrientation: ảnh chụp dọc trên iPhone có cờ EXIF; không tôn trọng
            // cờ này thì minh chứng bị xoay ngang.
            return await createImageBitmap(file, { imageOrientation: 'from-image' });
        } catch (_) {
            /* rơi xuống cách dựng <img> bên dưới */
        }
    }
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Không đọc được ảnh')); };
        image.src = url;
    });
}

/**
 * Nén một ảnh về dưới ngưỡng. Giảm chất lượng trước, hết mức mới thu nhỏ kích thước.
 * Nếu kết quả không nhỏ hơn ảnh gốc thì giữ ảnh gốc.
 *
 * @param {File} file
 * @returns {Promise<File>}
 */
export async function compressImage(file) {
    if (file.size <= IMAGE_TARGET_MAX_BYTES) return file;

    const source = await loadImageSource(file);
    const sourceWidth = source.width || source.naturalWidth;
    const sourceHeight = source.height || source.naturalHeight;
    const initialScale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(sourceWidth, sourceHeight));

    let width = Math.max(1, Math.round(sourceWidth * initialScale));
    let height = Math.max(1, Math.round(sourceHeight * initialScale));
    let quality = 0.84;
    let blob = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        // Tô trắng trước: ảnh PNG trong suốt chuyển sang JPEG sẽ thành nền đen.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.drawImage(source, 0, 0, width, height);
        blob = await canvasToBlob(canvas, 'image/jpeg', quality);

        if (blob.size <= IMAGE_TARGET_MAX_BYTES) break;
        if (quality > 0.5) {
            quality -= 0.1;
        } else {
            width = Math.max(1, Math.round(width * 0.84));
            height = Math.max(1, Math.round(height * 0.84));
        }
    }

    if (typeof source.close === 'function') source.close();
    if (!blob || blob.size >= file.size) return file;

    const outputName = `${file.name.replace(/\.[^.]+$/, '')}_compressed.jpg`;
    return new File([blob], outputName, { type: 'image/jpeg', lastModified: file.lastModified });
}

/**
 * Nén lần lượt cả bộ ảnh, báo tiến độ theo từng ảnh.
 * @param {File[]} files
 * @param {(info:{index:number, total:number, name:string}) => void} [onStep]
 */
export async function compressAll(files, onStep) {
    const compressed = [];
    for (let index = 0; index < files.length; index += 1) {
        onStep?.({ index: index + 1, total: files.length, name: files[index].name });
        compressed.push(await compressImage(files[index]));
    }
    return compressed;
}

export function formatKb(bytes) {
    return Math.max(1, Math.round(bytes / 1024));
}
