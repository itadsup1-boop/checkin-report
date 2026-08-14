/**
 * Bước 4: sửa sản phẩm của từng dịch vụ.
 *
 * Mỗi dịch vụ là một thẻ riêng, kể cả khi trùng sản phẩm — đúng quy tắc domain:
 * cùng một sản phẩm ở hai dịch vụ vẫn là hai dòng.
 *
 * Ba mức cảnh báo tồn kho, tính trên TỔNG nhu cầu của cả đơn chứ không theo từng
 * dòng, vì hai dịch vụ có thể cùng cần một sản phẩm:
 *   đủ tại cơ sở            -> không báo
 *   thiếu tại cơ sở, đủ tổng -> "cần lấy bù" (vàng)
 *   thiếu cả hai cơ sở       -> "thiếu hàng" (đỏ), chặn gửi đơn
 */

import { h, cx } from '../../../../../shared-ui/core/dom.js';
import { icon } from '../../../../../shared-ui/ui/icons.js';
import { notice, stepper } from '../../../ui/components.js';
import { branchName, stockOf } from '../../../data/warehouse-repo.js';
import { otherBranch } from '../../../../../shared-ui/core/branches.js';
import { missingRows, transferRows } from '../order-draft.js';

/** Một dòng sản phẩm: tên, nguồn, cảnh báo tồn, stepper số lượng, nút loại bỏ. */
function renderLine({ state, catalog, serviceId, line, actions }) {
    const entry = stockOf(catalog.stock, line.product_id);
    const local = state.branch === 'UK' ? entry.stock_uk : entry.stock_us;
    const total = entry.stock_us + entry.stock_uk;
    const over = line.actual_quantity > total;
    const needTransfer = !over && line.actual_quantity > local;

    let stockNote = `Tồn ${branchName(state.branch)}: ${local}`;
    if (over) stockNote += ' · không đủ toàn hệ thống';
    else if (needTransfer) stockNote += ' · cần lấy bù từ cơ sở kia';

    return h('div', {
        style: {
            padding: '12px 14px',
            opacity: line.is_removed ? '.5' : '1'
        }
    },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '10px' } },
            h('div', { style: { flex: '1', minWidth: '0' } },
                h('div', {
                    class: 'product__name',
                    style: { textDecoration: line.is_removed ? 'line-through' : 'none' }
                }, line.product_name),
                h('div', { class: 'product__code', style: { marginTop: '2px' } },
                    `${line.barcode || 'không mã'} · ${line.item_source === 'TEMPLATE' ? 'Theo mẫu' : 'Thêm riêng'}`
                ),
                h('div', {
                    style: {
                        fontSize: '11px', marginTop: '5px', fontWeight: over || needTransfer ? '700' : '400',
                        color: over ? 'var(--bad)' : needTransfer ? 'var(--warn)' : 'var(--muted)'
                    }
                }, stockNote)
            ),
            h('button', {
                class: cx('btn-mini', line.is_removed ? 'btn-mini--ok' : 'btn-mini--danger'),
                type: 'button',
                onClick: () => actions.toggleRemoveLine(serviceId, line.product_id)
            }, line.is_removed ? 'Khôi phục' : 'Loại bỏ')
        ),
        !line.is_removed
            ? h('div', { style: { marginTop: '10px', display: 'flex' } },
                stepper({
                    value: line.actual_quantity,
                    min: 1,
                    over,
                    onChange: quantity => actions.setLineQuantity(serviceId, line.product_id, quantity)
                })
            )
            : null
    );
}

/**
 * @param {object} params
 * @param {object} params.state
 * @param {object} params.catalog
 * @param {object} params.actions toggleRemoveLine · setLineQuantity · addProduct · scan
 */
export function renderProductStep({ state, catalog, actions }) {
    const missing = missingRows(state, catalog);
    const transfers = transferRows(state, catalog);
    const serviceById = id => catalog.services.find(service => service.id === id);

    return h('div', { class: 'stack' },
        missing.length > 0
            ? notice('bad',
                h('span', { class: 'strong' }, 'Thiếu hàng: '),
                missing.map(row => `${row.name} (cần ${row.required}, có ${row.total})`).join('; ')
            )
            : null,
        transfers.length > 0
            ? notice('warn',
                h('span', { class: 'strong' }, 'Cần lấy bù: '),
                transfers.map(row =>
                    `${row.name} lấy ${row.transfer} từ ${branchName(otherBranch(state.branch))}`
                ).join('; ')
            )
            : null,

        ...[...state.selections.entries()].map(([serviceId, items]) => {
            const service = serviceById(serviceId);
            if (!service) return null;

            // Chỉ gợi ý thêm những sản phẩm chưa có trong dịch vụ này.
            const available = catalog.products.filter(product =>
                !items.some(line => line.product_id === product.id && !line.is_removed));

            return h('div', { class: 'card' },
                h('div', { class: 'card__head' },
                    icon('layers', { size: 15, class: 'text-brand' }),
                    h('span', { style: { flex: '1' } }, service.service_name),
                    h('button', {
                        class: 'btn-mini btn-mini--scan', type: 'button',
                        onClick: () => actions.scanIntoService(serviceId)
                    }, 'Quét mã')
                ),
                h('div', { class: 'rows' },
                    items.map(line => renderLine({ state, catalog, serviceId, line, actions }))
                ),
                available.length > 0
                    ? h('div', {
                        style: {
                            display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px',
                            padding: '10px 14px', background: 'var(--surface)',
                            borderTop: '1px solid var(--line-soft)'
                        }
                    },
                        h('select', {
                            class: 'field__input',
                            style: { height: '40px', fontSize: '13px' },
                            onChange: event => {
                                if (!event.target.value) return;
                                actions.addProductToService(serviceId, event.target.value);
                            }
                        },
                            h('option', { value: '' }, 'Thêm sản phẩm đang có…'),
                            available.map(product => h('option', { value: product.id },
                                product.barcode
                                    ? `${product.product_name} (${product.barcode})`
                                    : product.product_name
                            ))
                        )
                    )
                    : null
            );
        })
    );
}
