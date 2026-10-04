/**
 * Phần 3 — Ảnh / video minh chứng, hai chế độ nộp:
 *
 *   mini_app       Chọn tệp ngay trong Mini App rồi gửi kèm hồ sơ. Bắt buộc
 *                  có ít nhất một tệp.
 *   telegram_reply Gửi hồ sơ trước, bot đăng một tin trong nhóm, nhân viên
 *                  quay lại nhóm và reply ảnh vào tin đó. Dùng khi tệp quá
 *                  nặng hoặc mạng yếu — Telegram tải khoẻ hơn Mini App.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { MEDIA_MODES, isDuplicateFile } from '../domain/record-rules.js';
import { MAX_MEDIA_FILES } from '../data/customer-repo.js';
import { card, sectionTitle, radioOption, previewItem, VIDEO_THUMB } from '../ui/components.js';

export function createMediaSection() {
    let mode = MEDIA_MODES.MINI_APP;
    let files = [];

    const previews = h('div', { class: 'preview-container' });

    const fileInput = h('input', {
        type: 'file',
        accept: 'image/*,video/*',
        multiple: true,
        class: 'hidden',
        onChange: event => {
            for (const file of Array.from(event.target.files || [])) {
                if (files.length >= MAX_MEDIA_FILES) break;
                if (isDuplicateFile(files, file)) continue;
                files.push(file);
                addPreview(file);
            }
            // Xoá value để chọn lại đúng tệp vừa gỡ ra vẫn kích hoạt onChange.
            event.target.value = '';
        }
    });

    function addPreview(file) {
        const isVideo = !file.type.startsWith('image/');
        const item = previewItem({
            src: isVideo ? VIDEO_THUMB : '',
            isVideo,
            onRemove: () => {
                files = files.filter(current => current !== file);
                item.remove();
            }
        });
        if (!isVideo) {
            const reader = new FileReader();
            reader.onload = event => { item.querySelector('img').src = event.target.result; };
            reader.readAsDataURL(file);
        }
        previews.appendChild(item);
    }

    const uploadArea = h('div', null,
        h('button', {
            class: 'btn btn-outline', type: 'button', onClick: () => fileInput.click()
        }, '📎 Chọn ảnh / video'),
        fileInput,
        previews
    );

    const replyHelp = h('div', { class: 'reply-help' },
        'Sau khi gửi, hãy quay lại nhóm và ',
        h('strong', null, 'reply ảnh/video'),
        ' vào tin nhắn Bot vừa đăng.'
    );
    replyHelp.style.display = 'none';

    function setMode(value) {
        mode = value;
        const isReply = value === MEDIA_MODES.TELEGRAM_REPLY;
        uploadArea.style.display = isReply ? 'none' : 'block';
        replyHelp.style.display = isReply ? 'block' : 'none';
    }

    const node = card(
        sectionTitle('Ảnh / video minh chứng'),
        radioOption({
            name: 'mediaMode', value: MEDIA_MODES.MINI_APP, checked: true,
            title: 'Tải lên tại đây',
            description: `Chọn tối đa ${MAX_MEDIA_FILES} tệp, gửi kèm hồ sơ.`,
            onChange: setMode
        }),
        radioOption({
            name: 'mediaMode', value: MEDIA_MODES.TELEGRAM_REPLY,
            title: 'Reply trong nhóm Telegram',
            description: 'Dùng khi tệp nặng hoặc mạng yếu.',
            onChange: setMode
        }),
        uploadArea,
        replyHelp
    );

    return {
        node,
        getMode: () => mode,
        getFiles: () => (mode === MEDIA_MODES.MINI_APP ? files : []),
        reset() {
            files = [];
            replaceChildren(previews);
        }
    };
}
