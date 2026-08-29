/**
 * Bước 3: ảnh minh chứng.
 *
 * Bắt buộc tối thiểu 1 ảnh (server cũng từ chối phiếu không có ảnh) và tối đa 6.
 * CHỈ nhận ảnh — chọn video sẽ bị loại và báo rõ, vì luồng nhập kho không lưu video.
 *
 * Ảnh được nén ngay trước khi gửi (media/image-compressor.js), không nén ở đây, để
 * xem trước vẫn là ảnh gốc và nhân sự kiểm tra được chữ trên hộp có đọc nổi không.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { alertUser } from '../../../shared-ui/core/telegram.js';
import { MAX_PROOF_IMAGES } from '../domain/import-draft.js';
import { IMAGE_TARGET_MAX_BYTES } from '../media/image-compressor.js';
import { photoTile, photoAddTile, notice } from '../ui/components.js';

const TARGET_KB = Math.round(IMAGE_TARGET_MAX_BYTES / 1024);

/**
 * @param {object} params
 * @param {() => Array<{id:string, file:File, url:string}>} params.getPhotos
 * @param {(files:File[]) => void} params.onAdd
 * @param {(id:string) => void} params.onRemove
 */
export function createPhotosStep({ getPhotos, onAdd, onRemove }) {
    const root = h('div');

    const fileInput = h('input', {
        type: 'file',
        accept: 'image/*',
        multiple: true,
        class: 'hidden',
        onChange: event => {
            const chosen = Array.from(event.target.files || []);
            const images = chosen.filter(file => file.type.startsWith('image/'));

            if (images.length !== chosen.length) {
                alertUser('Chức năng nhập kho chỉ nhận hình ảnh. Vui lòng không chọn video.');
            }

            const slots = Math.max(0, MAX_PROOF_IMAGES - getPhotos().length);
            if (images.length > slots) {
                alertUser(`Chỉ được chọn tối đa ${MAX_PROOF_IMAGES} ảnh minh chứng.`);
            }

            if (slots > 0) onAdd(images.slice(0, slots));
            // Xóa value để chọn lại đúng file vừa bỏ ra vẫn kích hoạt onChange.
            event.target.value = '';
            render();
        }
    });

    function render() {
        const photos = getPhotos();
        replaceChildren(root,
            h('div', { class: 'hint' },
                `Bắt buộc tối thiểu 1 ảnh, tối đa ${MAX_PROOF_IMAGES} ảnh. Không nhận video.`),
            fileInput,
            h('div', { class: 'photo-grid' },
                photos.map(photo => photoTile({
                    photo,
                    onRemove: () => { onRemove(photo.id); render(); }
                })),
                photos.length < MAX_PROOF_IMAGES
                    ? photoAddTile({ onClick: () => fileInput.click() })
                    : null
            ),
            h('div', { class: 'hint' },
                `${photos.length}/${MAX_PROOF_IMAGES} ảnh · ảnh sẽ được tự nén về khoảng ${TARGET_KB}KB trước khi gửi.`),
            photos.length === 0
                ? notice('warn', 'Cần ít nhất 1 ảnh minh chứng để xác nhận nhập kho.')
                : null
        );
    }

    render();
    return { root, refresh: render };
}
