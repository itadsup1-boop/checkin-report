/**
 * Màn hình sau khi nhập kho thành công.
 *
 * Nói rõ "tồn kho đã cộng ngay, không cần chờ duyệt" vì luồng xuất kho thì PHẢI chờ
 * duyệt — hai luồng khác nhau nên dễ nhầm.
 */

import { h } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { closeApp } from '../../../shared-ui/core/telegram.js';
import { totalQuantity } from '../domain/import-draft.js';
import { branchName } from '../data/import-repo.js';
import { button, reviewRow } from '../ui/components.js';

export function createDoneScreen({ branch, items, photoCount }) {
    return h('div', { class: 'center' },
        h('div', { class: 'done-mark' }, icon('check', { size: 38, stroke: 3 })),
        h('div', { style: { fontSize: '18px', fontWeight: '800', marginBottom: '6px' } },
            'Đã ghi nhận nhập kho'),
        h('div', { class: 'text-muted', style: { fontSize: '14px', marginBottom: '20px' } },
            'Tồn kho ',
            h('span', { class: 'strong', style: { color: 'var(--ink)' } }, branchName(branch)),
            ' đã được cộng ngay, không cần chờ duyệt.'
        ),

        h('div', { class: 'review-card', style: { width: '100%', textAlign: 'left' } },
            reviewRow({ iconName: 'mapPin', label: 'Cơ sở', value: branchName(branch) }),
            reviewRow({ iconName: 'package', label: 'Số sản phẩm', value: String(items.length) }),
            reviewRow({ iconName: 'boxIn', label: 'Tổng số lượng', value: `+${totalQuantity(items)}` }),
            reviewRow({ iconName: 'image', label: 'Ảnh minh chứng', value: `${photoCount} ảnh` })
        ),

        h('div', { style: { width: '100%', marginTop: '4px' } },
            button({ label: 'Hoàn tất & đóng', iconName: 'check', onClick: () => closeApp() })
        ),

        h('div', { class: 'text-muted', style: { fontSize: '11px', marginTop: '14px', lineHeight: '1.6' } },
            'Hệ thống đang chạy nền: lưu ảnh, tạo thư mục Drive, gửi thông báo Telegram, '
            + 'đồng bộ Google Sheet và tồn kho.')
    );
}
