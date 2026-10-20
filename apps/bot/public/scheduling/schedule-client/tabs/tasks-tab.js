/**
 * Tab 4 — Nhiệm vụ: các lịch còn "nợ ảnh" trong ngày.
 *
 * Ảnh chụp xong được thu nhỏ rồi gửi dưới dạng base64 tới /api/upload-proof.
 * Ô chọn ngày dùng chung với tab Check lịch.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { loadPhotoDebts, uploadProof } from '../data/schedule-repo.js';
import { formatTime } from '../domain/schedule-rules.js';
import { toCompressedDataUrl, TASK_PHOTO_QUALITY } from '../media/photo.js';
import { card, sectionTitle, loader, emptyText, timelineItem, button, createAlert } from '../ui/components.js';

export function createTasksTab({ getDate }) {
    const alert = createAlert();
    const list = h('div', null, emptyText('Vui lòng chọn ngày'));

    let pendingId = null;

    const fileInput = h('input', {
        type: 'file',
        accept: 'image/*',
        capture: 'environment',
        class: 'hidden',
        onChange: async event => {
            const file = event.target.files?.[0];
            // Xoá value ngay để chọn lại đúng ảnh vừa bỏ ra vẫn kích hoạt onChange.
            event.target.value = '';
            if (!file || !pendingId) return;

            try {
                const imageBase64 = await toCompressedDataUrl(file, TASK_PHOTO_QUALITY);
                alert.progress('Đang tải ảnh lên... Vui lòng đợi!');
                const data = await uploadProof({ id: pendingId, imageBase64 });
                if (data.success) {
                    alert.show('✅ Tải ảnh thành công!', false);
                    reload();
                } else {
                    alert.show(`Lỗi: ${data.error}`);
                }
            } catch (_) {
                alert.show('Lỗi mạng khi tải ảnh!');
            }
        }
    });

    function debtRow(item) {
        return timelineItem({
            stacked: true,
            tone: 'debt',
            children: h('div', { class: 'row-between' },
                h('div', null,
                    h('strong', { class: 'debt-name' }, item.customer_name),
                    h('small', { class: 'debt-meta' },
                        `Lúc: ${formatTime(item.appointment_time)} | NV: ${item.employee_name}`)
                ),
                button({
                    label: '📸 Tải Ảnh',
                    size: 'sm',
                    variant: 'danger',
                    onClick: () => { pendingId = item.id; fileInput.click(); }
                })
            )
        });
    }

    async function reload() {
        const date = getDate();
        if (!date) return;

        replaceChildren(list, loader());
        try {
            const items = await loadPhotoDebts(date);
            replaceChildren(list,
                items.length
                    ? items.map(debtRow)
                    : emptyText('🎉 Quá tuyệt! Bạn không còn nợ ảnh nào trong ngày này.', 'ok')
            );
        } catch (_) {
            replaceChildren(list, emptyText('Lỗi tải dữ liệu!', 'bad'));
        }
    }

    const node = card(
        sectionTitle('Nhiệm Vụ Trong Ngày'),
        alert.node,
        list,
        fileInput
    );

    return { node, reload };
}
