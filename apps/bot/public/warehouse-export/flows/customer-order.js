/**
 * Luồng "Xuất theo khách hàng" — 5 bước: cơ sở → khách → dịch vụ → sản phẩm → xác nhận.
 *
 * Gửi tới POST /api/warehouse/service-orders với payload giữ đúng contract cũ:
 *   { customer_name, customer_phone, branch, idempotency_key,
 *     services: [{ service_id, items: [{ product_id, product_name, barcode,
 *                  actual_quantity, template_quantity, item_source, is_removed,
 *                  display_order }] }] }
 *
 * Sản phẩm được tách riêng theo từng dịch vụ: cùng một sản phẩm xuất hiện ở hai
 * dịch vụ vẫn là hai dòng, đúng quy tắc domain. Tồn kho chỉ cộng ngầm khi kiểm
 * tra tổng để cảnh báo thiếu hàng.
 */

import { h, replaceChildren, cx } from '../core/dom.js';
import { icon } from '../ui/icons.js';
import {
    topBar, stepDots, bottomBar, primaryButton, notice, branchPicker,
    textField, stepper, card, summaryRow, successScreen
} from '../ui/components.js';
import { apiPost, newIdempotencyKey } from '../core/api.js';
import { createDraftStore } from '../core/draft.js';
import {
    branchName, localStock, otherStock, stockOf, lookupCustomerByPhone
} from '../data/warehouse-repo.js';
import { alertUser, notifySuccess, notifyError, tapFeedback, closeApp } from '../core/telegram.js';
import { openScanner } from '../ui/scanner.js';

const STEP_TITLES = ['Cơ sở', 'Khách hàng', 'Dịch vụ', 'Sản phẩm', 'Xác nhận'];
const TOTAL_STEPS = STEP_TITLES.length;

export function createCustomerOrderFlow({ catalog, onExit }) {
    const draft = createDraftStore('customer');
    const root = h('div', { style: { display: 'contents' } });

    const state = {
        step: 0,
        branch: null,
        customerName: '',
        customerPhone: '',
        /** Map<serviceId, Array<line>> — thứ tự chèn giữ đúng thứ tự người dùng chọn. */
        selections: new Map(),
        idempotencyKey: newIdempotencyKey(),
        suggestion: null,
        submitting: false,
        submittedOrder: null
    };

    restoreDraft();

    function restoreDraft() {
        const saved = draft.load();
        if (!saved) return;
        state.branch = saved.branch || null;
        state.customerName = saved.customer_name || '';
        state.customerPhone = saved.customer_phone || '';
        state.idempotencyKey = saved.idempotency_key || newIdempotencyKey();
        for (const entry of saved.services || []) {
            const service = catalog.services.find(item => item.id === entry.service_id);
            if (service) state.selections.set(service.id, entry.items || []);
        }
    }

    function buildPayload() {
        return {
            customer_name: state.customerName.trim(),
            customer_phone: state.customerPhone.trim(),
            branch: state.branch,
            idempotency_key: state.idempotencyKey,
            services: [...state.selections.entries()].map(([serviceId, items]) => ({
                service_id: serviceId,
                items
            }))
        };
    }

    const persist = () => draft.save(buildPayload());

    /* ---------- Dữ liệu dẫn xuất ---------- */

    const serviceById = id => catalog.services.find(service => service.id === id);
    const activeLines = items => items.filter(line => !line.is_removed);

    /** Tổng số lượng cần cho mỗi sản phẩm, cộng ngầm qua tất cả dịch vụ. */
    function requiredByProduct() {
        const totals = new Map();
        for (const items of state.selections.values()) {
            for (const line of activeLines(items)) {
                totals.set(line.product_id, (totals.get(line.product_id) || 0) + Number(line.actual_quantity || 0));
            }
        }
        return totals;
    }

    /** Phân tích khả năng đáp ứng: đủ tại cơ sở / cần điều chuyển / thiếu toàn hệ thống. */
    function availability() {
        const rows = [];
        for (const [productId, required] of requiredByProduct()) {
            const local = localStock(catalog.stock, productId, state.branch);
            const other = otherStock(catalog.stock, productId, state.branch);
            const product = catalog.products.find(item => item.id === productId);
            rows.push({
                productId,
                name: product?.product_name || 'Sản phẩm đã bị xóa',
                required,
                local,
                other,
                total: local + other,
                transfer: Math.max(0, required - local),
                missing: Math.max(0, required - local - other)
            });
        }
        return rows;
    }

    const totalQty = () => [...requiredByProduct().values()].reduce((sum, value) => sum + value, 0);
    const missingRows = () => availability().filter(row => row.missing > 0);
    const transferRows = () => availability().filter(row => row.missing === 0 && row.transfer > 0);

    /* ---------- Thao tác ---------- */

    function toggleService(serviceId) {
        tapFeedback();
        if (state.selections.has(serviceId)) {
            state.selections.delete(serviceId);
        } else {
            const service = serviceById(serviceId);
            if (!service) return;
            state.selections.set(serviceId, service.items.map((item, index) => ({
                product_id: item.product_id,
                product_name: item.product_name,
                barcode: item.barcode,
                actual_quantity: item.default_quantity,
                template_quantity: item.default_quantity,
                item_source: 'TEMPLATE',
                is_removed: false,
                display_order: index
            })));
        }
        persist();
        render();
    }

    function setLineQuantity(serviceId, productId, quantity) {
        const items = state.selections.get(serviceId);
        const line = items?.find(item => item.product_id === productId);
        if (!line) return;
        line.actual_quantity = Math.max(1, quantity);
        persist();
        render();
    }

    function toggleRemoveLine(serviceId, productId) {
        const items = state.selections.get(serviceId);
        const line = items?.find(item => item.product_id === productId);
        if (!line) return;
        line.is_removed = !line.is_removed;
        persist();
        render();
    }

    function addProductToService(serviceId, productId) {
        const items = state.selections.get(serviceId);
        const product = catalog.products.find(item => item.id === productId);
        if (!items || !product) return;

        const existing = items.find(line => line.product_id === productId);
        if (existing) {
            existing.is_removed = false;
            existing.actual_quantity += 1;
        } else {
            items.push({
                product_id: product.id,
                product_name: product.product_name,
                barcode: product.barcode,
                actual_quantity: 1,
                template_quantity: null,
                item_source: 'MANUAL',
                is_removed: false,
                display_order: items.length
            });
        }
        persist();
        render();
    }

    async function scanIntoService(serviceId) {
        await openScanner({
            onDetected: code => {
                const product = catalog.products.find(item => item.barcode === code);
                if (!product) {
                    alertUser('Mã này chưa có trong kho. Hãy nhập sản phẩm trước.');
                    return;
                }
                addProductToService(serviceId, product.id);
            }
        });
    }

    /**
     * Vùng hiển thị gợi ý khách cũ.
     * Tách riêng khỏi render() vì tra cứu chạy nền trong lúc người dùng còn đang
     * gõ số điện thoại — render lại cả bước sẽ tạo lại input và làm mất focus.
     */
    const suggestionSlot = h('div');

    function renderSuggestion() {
        if (!state.suggestion) {
            replaceChildren(suggestionSlot);
            return;
        }
        replaceChildren(suggestionSlot, notice('ok',
            h('span', null, 'Khách cũ: '),
            h('span', { class: 'strong' }, state.suggestion.customer_name),
            h('button', {
                class: 'btn-mini', type: 'button', style: { marginLeft: '8px' },
                onClick: () => {
                    state.customerName = state.suggestion.customer_name;
                    persist();
                    render();
                }
            }, 'Dùng tên này')
        ));
    }

    let lookupTimer = null;
    function scheduleCustomerLookup() {
        clearTimeout(lookupTimer);
        lookupTimer = setTimeout(async () => {
            const phone = state.customerPhone.trim();
            if (phone.length < 4) {
                state.suggestion = null;
                renderSuggestion();
                return;
            }
            try {
                const data = await lookupCustomerByPhone(phone);
                state.suggestion = data.customer || null;
            } catch {
                state.suggestion = null;
            }
            renderSuggestion();
        }, 450);
    }

    function canAdvance() {
        switch (state.step) {
            case 0: return Boolean(state.branch);
            case 1: return state.customerName.trim().length > 0 && state.customerPhone.trim().length >= 8;
            case 2: return state.selections.size > 0;
            case 3: return totalQty() > 0;
            default: return true;
        }
    }

    function goNext() {
        if (!canAdvance()) return;
        state.step = Math.min(TOTAL_STEPS - 1, state.step + 1);
        render();
    }

    function goBack() {
        if (state.step === 0) {
            onExit();
            return;
        }
        state.step -= 1;
        render();
    }

    async function submit() {
        if (state.submitting) return;
        if (missingRows().length > 0) {
            alertUser('Còn sản phẩm không đủ tồn trên toàn hệ thống. Hãy giảm số lượng hoặc nhập thêm kho.');
            return;
        }

        state.submitting = true;
        render();
        try {
            const data = await apiPost('/api/warehouse/service-orders', { ...buildPayload(), submit: true });
            draft.clear();
            notifySuccess();
            state.submittedOrder = data.order;
        } catch (error) {
            notifyError();
            const detail = Array.isArray(error.details)
                ? '\n' + error.details.map(item => `${item.product_name}: thiếu ${item.missing}`).join('\n')
                : '';
            alertUser(error.message + detail);
        } finally {
            state.submitting = false;
            render();
        }
    }

    /* ---------- Render từng bước ---------- */

    function renderCustomerStep() {
        return h('div', null,
            h('p', { class: 'section-label' }, 'Thông tin khách hàng nhận dịch vụ'),
            textField({
                label: 'Tên khách hàng',
                iconName: 'user',
                value: state.customerName,
                placeholder: 'VD: Nguyễn Thị A',
                onInput: value => { state.customerName = value; persist(); updateFooter(); }
            }),
            textField({
                label: 'Số điện thoại',
                iconName: 'phone',
                value: state.customerPhone,
                placeholder: 'VD: 0987 654 321',
                inputMode: 'tel',
                maxLength: 20,
                onInput: value => {
                    state.customerPhone = value.replace(/[^0-9+ ]/g, '');
                    persist();
                    updateFooter();
                    scheduleCustomerLookup();
                }
            }),
            suggestionSlot
        );
    }

    function renderServiceStep() {
        if (catalog.services.length === 0) {
            return notice('warn', 'Admin chưa cấu hình dịch vụ nào đang hoạt động.');
        }
        return h('div', null,
            h('p', { class: 'section-label' }, 'Chọn một hoặc nhiều dịch vụ cho khách'),
            h('div', { class: 'stack-sm' },
                catalog.services.map(service => {
                    const on = state.selections.has(service.id);
                    return h('button', {
                        class: cx('choice', on && 'choice--on'),
                        type: 'button',
                        onClick: () => toggleService(service.id)
                    },
                        h('div', { class: 'choice__icon' }, icon('layers', { size: 18 })),
                        h('div', { class: 'choice__main' },
                            h('div', { class: 'choice__title' }, service.service_name),
                            h('div', { class: 'choice__sub' }, `${service.items.length} sản phẩm mẫu`)
                        ),
                        h('div', { class: 'choice__tick' }, on ? icon('check', { size: 14 }) : null)
                    );
                })
            )
        );
    }

    function renderProductStep() {
        const missing = missingRows();
        const transfers = transferRows();

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
                        `${row.name} lấy ${row.transfer} từ ${branchName(state.branch === 'US' ? 'UK' : 'US')}`
                    ).join('; ')
                )
                : null,

            ...[...state.selections.entries()].map(([serviceId, items]) => {
                const service = serviceById(serviceId);
                if (!service) return null;

                const available = catalog.products.filter(product =>
                    !items.some(line => line.product_id === product.id && !line.is_removed));

                return h('div', { class: 'card' },
                    h('div', { class: 'card__head' },
                        icon('layers', { size: 15, class: 'text-brand' }),
                        h('span', { style: { flex: '1' } }, service.service_name),
                        h('button', {
                            class: 'btn-mini btn-mini--scan', type: 'button',
                            onClick: () => scanIntoService(serviceId)
                        }, 'Quét mã')
                    ),
                    h('div', { class: 'rows' },
                        items.map(line => renderLine(serviceId, line))
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
                                    addProductToService(serviceId, event.target.value);
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

    function renderLine(serviceId, line) {
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
                    onClick: () => toggleRemoveLine(serviceId, line.product_id)
                }, line.is_removed ? 'Khôi phục' : 'Loại bỏ')
            ),
            !line.is_removed
                ? h('div', { style: { marginTop: '10px', display: 'flex' } },
                    stepper({
                        value: line.actual_quantity,
                        min: 1,
                        over,
                        onChange: quantity => setLineQuantity(serviceId, line.product_id, quantity)
                    })
                )
                : null
        );
    }

    function renderConfirmStep() {
        const missing = missingRows();

        return h('div', { class: 'stack' },
            card({
                title: 'Thông tin đơn',
                iconName: 'clipboard',
                body: h('div', null,
                    summaryRow('Cơ sở', branchName(state.branch)),
                    summaryRow('Khách hàng', state.customerName.trim()),
                    summaryRow('Số điện thoại', state.customerPhone.trim())
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
                            const total = (() => {
                                const entry = stockOf(catalog.stock, line.product_id);
                                return entry.stock_us + entry.stock_uk;
                            })();
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
                h('span', { class: 'total__value' }, String(totalQty()))
            ),

            h('p', { class: 'hint center', style: { padding: '0 12px', lineHeight: '1.6' } },
                'Nhân viên tạo đơn cần người có quyền kho trong nhóm duyệt trước khi trừ tồn.')
        );
    }

    function renderStepBody() {
        switch (state.step) {
            case 0:
                return branchPicker({
                    selected: state.branch,
                    onSelect: code => { state.branch = code; persist(); render(); }
                });
            case 1: return renderCustomerStep();
            case 2: return renderServiceStep();
            case 3: return renderProductStep();
            default: return renderConfirmStep();
        }
    }

    /* ---------- Khung ---------- */

    const footer = bottomBar();

    function updateFooter() {
        const isLast = state.step === TOTAL_STEPS - 1;
        replaceChildren(footer,
            isLast
                ? primaryButton({
                    label: state.submitting ? 'Đang gửi…' : 'Gửi yêu cầu xuất kho',
                    iconName: state.submitting ? 'loader' : 'send',
                    spinning: state.submitting,
                    disabled: state.submitting,
                    onClick: submit
                })
                : primaryButton({
                    label: 'Tiếp tục',
                    iconName: 'chevronRight',
                    disabled: !canAdvance(),
                    onClick: goNext
                })
        );
    }

    function render() {
        if (state.submittedOrder) {
            const order = state.submittedOrder;
            replaceChildren(root, successScreen({
                title: 'Đã gửi yêu cầu xuất kho',
                message: order.status === 'APPROVED'
                    ? `Đơn của khách ${state.customerName.trim()} đã được duyệt và trừ tồn.`
                    : `Đơn của khách ${state.customerName.trim()} đang chờ người có quyền kho duyệt.`,
                rows: [
                    ['Mã đơn', order.order_code || '—'],
                    ['Cơ sở', branchName(state.branch)],
                    ['Số dịch vụ', String(state.selections.size)],
                    ['Tổng số lượng', String(totalQty())]
                ],
                onExit,
                onClose: () => closeApp()
            }));
            return;
        }

        updateFooter();
        replaceChildren(root,
            topBar({
                title: STEP_TITLES[state.step],
                subtitle: `Xuất theo khách hàng · Bước ${state.step + 1}/${TOTAL_STEPS}`,
                onBack: goBack
            }),
            stepDots(TOTAL_STEPS, state.step),
            h('div', { class: 'app__body' }, renderStepBody()),
            footer
        );
    }

    render();
    return root;
}
