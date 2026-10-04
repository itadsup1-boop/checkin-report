/**
 * Bước 4: xem lại và gửi phiếu nhập kho.
 *
 * Nhập kho được ghi nhận NGAY (không cần quản lý duyệt) nên đây là điểm không quay
 * lại được — vì vậy bước này hiện lại đủ ba thông tin quyết định (cơ sở, sản phẩm,
 * ảnh) trước khi gửi.
 *
 * Tiến độ hiển thị là tiến độ TẢI LÊN THẬT từ XMLHttpRequest, không phải đồng hồ
 * giả: nhân sự cần biết mạng có đang chạy hay đã đứng để quyết định chờ hay thử lại.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { totalQuantity } from '../domain/import-draft.js';
import { branchName } from '../data/import-repo.js';
import { reviewRow, totalRow, notice } from '../ui/components.js';

/**
 * @param {object} params
 * @param {string} params.branch
 * @param {() => Array} params.getItems
 * @param {() => Array} params.getPhotos
 * @param {() => void} params.onOpenList
 * @returns {{root:HTMLElement, setProgress:Function, clearProgress:Function}}
 */
export function createConfirmStep({ branch, getItems, getPhotos, onOpenList }) {
    const root = h('div');
    const progressSlot = h('div');

    function render() {
        const items = getItems();
        const photos = getPhotos();

        replaceChildren(root,
            h('div', { class: 'review-card' },
                reviewRow({ iconName: 'mapPin', label: 'Cơ sở nhận hàng', value: branchName(branch) }),
                reviewRow({
                    iconName: 'package',
                    label: 'Số sản phẩm',
                    value: String(items.length),
                    onClick: items.length ? onOpenList : undefined
                }),
                reviewRow({ iconName: 'image', label: 'Ảnh minh chứng', value: `${photos.length} ảnh` })
            ),
            totalRow({ total: totalQuantity(items) }),
            progressSlot,
            notice('info', 'Nhập kho được ghi nhận ngay, không cần quản lý duyệt trước. '
                + 'Sau khi gửi, hệ thống chạy nền: lưu ảnh, tạo thư mục Drive, gửi thông báo Telegram '
                + 'và đồng bộ Google Sheet.')
        );
    }

    /**
     * @param {number} percent 0..100
     * @param {string} label mô tả giai đoạn đang chạy
     */
    function setProgress(percent, label) {
        const fill = h('div', { class: 'progress-fill', style: { width: `${Math.min(percent, 100)}%` } });
        replaceChildren(progressSlot,
            h('div', { class: 'progress-card' },
                h('div', { class: 'progress-card__head' },
                    h('span', { class: 'text-muted' }, label),
                    h('span', { class: 'strong' }, `${Math.round(Math.min(percent, 100))}%`)
                ),
                h('div', { class: 'progress-track' }, fill),
                h('div', {
                    style: {
                        display: 'flex', alignItems: 'flex-start', gap: '5px',
                        marginTop: '10px', fontSize: '10.5px', color: 'var(--faint)'
                    }
                },
                    icon('alert', { size: 12, class: 'notice__icon' }),
                    'Không bấm gửi nhiều lần. Nếu quá 60 giây chưa xong, hãy kiểm tra kết nối mạng.'
                )
            )
        );
    }

    function clearProgress() {
        replaceChildren(progressSlot);
    }

    render();
    return { root, setProgress, clearProgress };
}
