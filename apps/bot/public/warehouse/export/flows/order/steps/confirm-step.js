/**
 * Bước 5: xem lại trước khi gửi.
 *
 * Chỉ liệt kê dòng còn hiệu lực (đã bỏ dòng bị loại) vì đây là thứ khách thực sự
 * nhận. Dòng bị loại vẫn nằm trong payload để server biết mẫu dịch vụ bị sửa gì.
 *
 * Đơn của nhân viên còn phải chờ duyệt mới trừ tồn — nói rõ ở cuối để không ai
 * tưởng bấm xong là hàng đã ra khỏi kho.
 */

import { h, cx } from '../../../../../shared-ui/core/dom.js';
import { icon } from '../../../../../shared-ui/ui/icons.js';
import { notice, card, summaryRow } from '../../../ui/components.js';
import { branchName, stockOf } from '../../../data/warehouse-repo.js';
import { activeLines, missingRows, totalQty } from '../order-draft.js';

export function renderConfirmStep({ state, catalog }) {
    const missing = missingRows(state, catalog);
    const serviceById = id => catalog.services.find(service => service.id === id);

    return h('div', { class: 'stack' },
        card({
            title: 'Thông tin đơn',
            iconName: 'clipboard',
            body: h('div', null,
                summaryRow('Cơ sở', branchName(state.branch)),
                summaryRow('Khách hàng', state.customerName.trim()),
                summaryRow('Số điện thoại', state.customerPhone.trim()),
                summaryRow('Bác sĩ', state.doctorName.trim()),
                summaryRow('Kỹ thuật viên', state.technicianName.trim())
            )
        }),

        missing.length > 0
            ? notice('bad', `Vẫn còn ${missing.length} sản phẩm không đủ tồn trên toàn hệ thống.`)
            : null,

        ...[...state.selections.entries()].map(([serviceId, items]) => {
            const service = serviceById(serviceId);
            const lines = activeLines(items);
            if (!service || lines.length === 0) return null;

            return h('div', { class: 'card' },
                h('div', { class: 'card__head' },
                    icon('layers', { size: 14, class: 'text-brand' }),
                    h('span', null, service.service_name)
                ),
                h('div', { class: 'rows' },
                    lines.map(line => {
                        const entry = stockOf(catalog.stock, line.product_id);
                        const total = entry.stock_us + entry.stock_uk;
                        return h('div', {
                            class: 'row-between',
                            style: { padding: '10px 14px' }
                        },
                            h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' } },
                                icon('package', { size: 14, class: 'text-muted' }),
                                h('span', { class: 'product__name', style: { fontSize: '13px' } }, line.product_name)
                            ),
                            h('span', {
                                class: cx('strong', line.actual_quantity > total && 'text-bad'),
                                style: { fontSize: '13px', flexShrink: '0' }
                            }, String(line.actual_quantity))
                        );
                    })
                )
            );
        }),

        h('div', { class: 'total' },
            h('span', { class: 'total__label' }, 'Tổng số lượng sản phẩm'),
            h('span', { class: 'total__value' }, String(totalQty(state)))
        ),

        h('p', { class: 'hint center', style: { padding: '0 12px', lineHeight: '1.6' } },
            'Nhân viên tạo đơn cần người có quyền kho trong nhóm duyệt trước khi trừ tồn.')
    );
}
