/**
 * Điều phối Mini App hồ sơ khách hàng.
 *
 * Một biểu mẫu, ba phần: thông tin khách · thanh toán · ảnh minh chứng.
 * File này chỉ nối các phần lại, kiểm tra trước khi gửi, và gọi API.
 * Quy tắc nằm ở domain/, markup nằm ở ui/ và sections/.
 */

import { h, replaceChildren, el } from '../../shared-ui/core/dom.js';
import { initTelegram, isInsideTelegram, closeApp } from '../../shared-ui/core/telegram.js';
import { checkRecord, todayLabel, MEDIA_MODES } from './domain/record-rules.js';
import { saveCustomerRecord, getAuthParams } from './data/customer-repo.js';
import { createAlert, createProgressOverlay, successScreen } from './ui/components.js';
import { createInfoSection } from './sections/info-section.js';
import { createMoneySection } from './sections/money-section.js';
import { createMediaSection } from './sections/media-section.js';

const mount = el('app');

function showError(message) {
    replaceChildren(mount,
        h('div', { class: 'card' },
            h('div', { class: 'section-title' }, 'Không mở được hồ sơ khách hàng'),
            h('div', { class: 'alert', style: { display: 'block' } }, message)
        )
    );
}

function start() {
    initTelegram();

    const { chatId } = getAuthParams();
    if (!chatId || !isInsideTelegram()) {
        showError('Vui lòng mở Mini App từ nút "Điền Thông Tin Khách Hàng" trong Telegram '
            + 'để hệ thống xác thực được phiên làm việc.');
        return;
    }

    const alert = createAlert();
    const overlay = createProgressOverlay();
    const info = createInfoSection();
    const money = createMoneySection();
    const media = createMediaSection();

    const submitButton = h('button', {
        class: 'btn btn-primary', type: 'submit'
    }, 'GHI NHẬN HỒ SƠ');

    async function submit(event) {
        event.preventDefault();
        alert.hide();

        const fields = { ...info.read(), ...money.read() };
        const verdict = checkRecord({
            phone: fields.phone,
            mediaMode: media.getMode(),
            fileCount: media.getFiles().length
        });
        if (!verdict.ok) {
            alert.show(verdict.message);
            return;
        }

        submitButton.disabled = true;
        overlay.show();
        try {
            const result = await saveCustomerRecord({
                fields,
                files: media.getFiles(),
                mediaMode: media.getMode(),
                onProgress: percent => overlay.set(percent)
            });
            overlay.hide();
            showSuccess(result.media_mode);
        } catch (error) {
            overlay.hide();
            submitButton.disabled = false;
            alert.show(error.message);
        }
    }

    function showSuccess(mediaMode) {
        // Chế độ reply còn việc phải làm tiếp trong nhóm, nên câu kết khác nhau.
        const description = mediaMode === MEDIA_MODES.TELEGRAM_REPLY
            ? 'Đã tạo hồ sơ. Hãy đóng Mini App, quay lại nhóm và reply ảnh/video vào tin nhắn Bot vừa gửi.'
            : 'Thông tin khách hàng đã được ghi nhận và đang được đồng bộ lên Google Sheets và Google Drive.';
        replaceChildren(mount, successScreen({ description, onClose: () => closeApp() }));
    }

    replaceChildren(mount,
        h('div', { class: 'header' },
            h('div', { class: 'header__title' }, 'Hồ sơ khách hàng'),
            h('div', { class: 'header__date' }, `Ngày ${todayLabel()}`)
        ),
        alert.node,
        h('form', { onSubmit: submit },
            info.node,
            money.node,
            media.node,
            h('div', { class: 'submit-row' }, submitButton)
        ),
        overlay.node
    );
}

start();
