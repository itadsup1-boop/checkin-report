/**
 * Sheet chi tiết một sản phẩm: tồn theo từng cơ sở + lịch sử biến động thật.
 *
 * Lịch sử đọc từ sổ ledger nên hiển thị được cả số dư TRƯỚC và SAU mỗi lần biến
 * động — nhân sự đối chiếu được "tại sao tồn lại thành số này", không chỉ thấy
 * mỗi con số cuối.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { icon } from '../../../shared-ui/ui/icons.js';
import { BRANCHES, stockStatus, loadProductHistory, NGUONG_SAP_HET } from '../data/inventory-repo.js';
import { statusBadge, emptyState, formatDualStockDisplay } from '../ui/components.js';

/**
 * Nhãn và màu cho từng loại biến động trong sổ ledger.
 * Khớp đúng các event_type mà tầng application ghi ra.
 *
 * Màu trỏ vào token trong shared-ui/theme-tokens.css, KHÔNG viết mã hex ở đây:
 * ba Mini App kho phải cùng một bộ màu, hex rải trong JS là chỗ đầu tiên bị lệch.
 * `tone` là tên token, `soft` là token nền nhạt tương ứng.
 */
const LOAI_BIEN_DONG = {
    PRODUCT_IMPORT:          { label: 'Nhập kho',              icon: 'arrowDownCircle', tone: 'ok' },
    CUSTOMER_EXPORT:         { label: 'Xuất cho khách',        icon: 'arrowUpCircle',   tone: 'bad' },
    TRANSFER_OUT:            { label: 'Chuyển sang cơ sở kia', icon: 'arrowLeftRight',  tone: 'warn' },
    TRANSFER_IN_DIRECT_USE:  { label: 'Nhận từ cơ sở kia',     icon: 'arrowLeftRight',  tone: 'warn' },
    REVERSAL:                { label: 'Hoàn tác',              icon: 'rotateCcw',       tone: 'brand' }
};

function moTaLoai(eventType) {
    return LOAI_BIEN_DONG[eventType]
        || { label: eventType, icon: 'package', tone: 'muted' };
}

function dinhDangThoiGian(value) {
    if (!value) return '';
    const date = new Date(value);
    const pad = number => String(number).padStart(2, '0');
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function theCoSo(branch, quantity, item) {
    const status = stockStatus(quantity);
    const dualText = formatDualStockDisplay(quantity, item?.baseUnit, item?.importUnit, item?.conversionRate);
    return h('div', { class: 'branch-card' },
        h('div', { class: 'branch-card__name' }, icon('mapPin', { size: 11 }), branch.name),
        h('div', { class: 'branch-card__qty' }, dualText),
        statusBadge(status)
    );
}

function dongLichSu(row) {
    const meta = moTaLoai(row.eventType);
    const dau = row.delta > 0 ? '+' : '';

    return h('div', { class: 'history-item' },
        h('div', { class: `history-item__icon history-item__icon--${meta.tone}` },
            icon(meta.icon, { size: 16 })),
        h('div', { class: 'history-item__main' },
            h('div', { class: 'history-item__title' },
                `${meta.label} ${dau}${row.delta}`
            ),
            h('div', { class: 'history-item__sub' },
                [
                    row.branch,
                    row.actorName || null,
                    // Số dư ảo của dòng điều chuyển-dùng-ngay không phản ánh tồn
                    // thật ở cơ sở đó, nên không hiển thị "còn X" cho nó.
                    row.virtualBalance ? null : `còn ${row.balanceAfter}`
                ].filter(Boolean).join(' · ')
            )
        ),
        h('div', { class: 'history-item__time' }, dinhDangThoiGian(row.createdAt))
    );
}

/**
 * @param {object} params
 * @param {object} params.item sản phẩm đang xem
 * @param {() => void} params.onClose
 */
export function createProductDetailSheet({ item, onClose }) {
    const tong = item.stockUS + item.stockUK;
    const historySlot = h('div', { class: 'history' },
        h('div', { class: 'text-muted', style: { fontSize: '12px' } }, 'Đang tải lịch sử…')
    );

    // Lịch sử tải sau, không chặn việc hiện tồn kho.
    loadProductHistory(item.id)
        .then(history => {
            replaceChildren(historySlot,
                history.length
                    ? history.map(dongLichSu)
                    : emptyState('Sản phẩm này chưa có biến động nào')
            );
        })
        .catch(error => {
            replaceChildren(historySlot,
                h('div', { class: 'text-muted', style: { fontSize: '12px' } },
                    `Không tải được lịch sử: ${error.message}`)
            );
        });

    return h('div', { class: 'sheet' },
        h('div', { class: 'sheet__mask', onClick: onClose }),
        h('div', { class: 'sheet__panel' },
            h('div', { class: 'sheet__head' },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: '0' } },
                    h('button', {
                        class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onClick: onClose
                    }, icon('chevronLeft', { size: 16 })),
                    h('div', { style: { minWidth: '0' } },
                        h('div', { class: 'sheet__title' }, item.name),
                        item.barcode ? h('div', { class: 'sheet__code' }, item.barcode) : null
                    )
                ),
                h('button', {
                    class: 'icon-btn', type: 'button', 'aria-label': 'Đóng', onClick: onClose
                }, icon('x', { size: 16 }))
            ),

            h('div', { class: 'sheet__body' },
                h('div', { style: { marginBottom: '18px' } },
                    h('div', { class: 'block-label' }, icon('layers3', { size: 13 }), 'Tồn kho theo cơ sở'),
                    h('div', { class: 'branch-cards' },
                        theCoSo(BRANCHES[0], item.stockUS, item),
                        theCoSo(BRANCHES[1], item.stockUK, item)
                    )
                ),

                h('div', { class: 'total-row', style: { marginBottom: '18px' } },
                    h('div', null,
                        h('div', { class: 'total-row__label' }, 'Tổng toàn hệ thống'),
                        h('div', { class: 'total-row__value' }, formatDualStockDisplay(tong, item.baseUnit, item.importUnit, item.conversionRate))
                    ),
                    h('div', { style: { textAlign: 'right' } },
                        h('div', { class: 'total-row__label' }, 'Ngưỡng cảnh báo'),
                        h('div', {
                            style: { fontSize: '13px', fontWeight: '700', color: 'var(--warn)' }
                        }, `≤ ${NGUONG_SAP_HET}`)
                    )
                ),

                h('div', null,
                    h('div', { class: 'block-label' },
                        icon('clock', { size: 13 }), 'Lịch sử nhập / xuất / điều chuyển'),
                    historySlot
                )
            )
        )
    );
}
