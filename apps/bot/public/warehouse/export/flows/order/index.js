/**
 * Luồng "Xuất theo khách hàng" — 5 bước: cơ sở → khách → dịch vụ → sản phẩm → xác nhận.
 *
 * File này chỉ điều phối: giữ state, nối các bước lại, gọi API. Quy tắc tính toán
 * nằm ở order-draft.js, markup nằm ở steps/.
 *
 * Gửi tới POST /api/warehouse/service-orders với payload giữ đúng contract cũ:
 *   { customer_name, customer_phone, doctor_name, technician_name, branch, idempotency_key,
 *     services: [{ service_id, items: [{ product_id, product_name, barcode,
 *                  actual_quantity, template_quantity, item_source, is_removed,
 *                  display_order }] }] }
 */

import { h, replaceChildren } from '../../../../shared-ui/core/dom.js';
import { apiPost, newIdempotencyKey } from '../../../../shared-ui/core/api.js';
import { createDraftStore } from '../../../../shared-ui/core/draft.js';
import { openScanner } from '../../../../shared-ui/ui/scanner.js';
import {
    alertUser, notifySuccess, notifyError, tapFeedback, closeApp
} from '../../../../shared-ui/core/telegram.js';
import {
    topBar, stepDots, bottomBar, primaryButton, notice, branchPicker, successScreen
} from '../../ui/components.js';
import { branchName, lookupCustomerByPhone } from '../../data/warehouse-repo.js';
import {
    STEP_TITLES, TOTAL_STEPS, phoneDigitCount, applyDraft, buildPayload,
    canAdvance, totalQty, missingRows,
    toggleService, setLineQuantity, toggleRemoveLine, addProductToService
} from './order-draft.js';
import { renderCustomerStep } from './steps/customer-step.js';
import { renderServiceStep } from './steps/service-step.js';
import { renderProductStep } from './steps/product-step.js';
import { renderConfirmStep } from './steps/confirm-step.js';

/** Chờ gõ xong mới tra khách cũ, tránh gọi API sau mỗi phím. */
const CUSTOMER_LOOKUP_DELAY_MS = 450;
const MIN_PHONE_DIGITS = 4;

export function createCustomerOrderFlow({ catalog, onExit }) {
    const draft = createDraftStore('customer');
    const root = h('div', { style: { display: 'contents' } });

    const state = {
        step: 0,
        branch: null,
        customerName: '',
        customerPhone: '',
        doctorName: '',
        technicianName: '',
        /** Map<serviceId, Array<line>> — thứ tự chèn giữ đúng thứ tự người dùng chọn. */
        selections: new Map(),
        idempotencyKey: newIdempotencyKey(),
        suggestion: null,
        submitting: false,
        submittedOrder: null
    };

    applyDraft(state, draft.load(), catalog, state.idempotencyKey);

    const persist = () => draft.save(buildPayload(state));

    /*
     * Ô gợi ý khách cũ do file này sở hữu, không tạo lại trong bước 2: tra cứu chạy
     * nền trong lúc người dùng còn gõ, vẽ lại ô mới sẽ làm kết quả đổ vào ô đã gỡ.
     */
    const suggestionSlot = h('div');
    const footer = bottomBar();

    /* ---------- Thao tác trên đơn ---------- */

    const actions = {
        toggleService(serviceId) {
            tapFeedback();
            toggleService(state, catalog, serviceId);
            persist();
            render();
        },
        setLineQuantity(serviceId, productId, quantity, { render: shouldRender = true } = {}) {
            setLineQuantity(state, serviceId, productId, quantity);
            persist();
            if (shouldRender) render();
        },
        toggleRemoveLine(serviceId, productId) {
            toggleRemoveLine(state, serviceId, productId);
            persist();
            render();
        },
        addProductToService(serviceId, productId) {
            addProductToService(state, catalog, serviceId, productId);
            persist();
            render();
        },
        async scanIntoService(serviceId) {
            await openScanner({
                onDetected: code => {
                    const product = catalog.products.find(item => item.barcode === code);
                    if (!product) {
                        alertUser('Mã này chưa có trong kho. Hãy nhập sản phẩm trước.');
                        return;
                    }
                    actions.addProductToService(serviceId, product.id);
                }
            });
        }
    };

    /* ---------- Gợi ý khách cũ ---------- */

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
            if (phoneDigitCount(phone) < MIN_PHONE_DIGITS) {
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
        }, CUSTOMER_LOOKUP_DELAY_MS);
    }

    /** Gõ thông tin chỉ cập nhật nút dưới, KHÔNG vẽ lại bước — vẽ lại là mất con trỏ. */
    function onCustomerChange(field, value) {
        if (field === 'name') {
            state.customerName = value;
            persist();
            updateFooter();
            return;
        }
        if (field === 'doctor') {
            state.doctorName = value;
            persist();
            updateFooter();
            return;
        }
        if (field === 'technician') {
            state.technicianName = value;
            persist();
            updateFooter();
            return;
        }
        state.customerPhone = value.replace(/[^0-9+ ]/g, '');
        persist();
        updateFooter();
        scheduleCustomerLookup();
    }

    /* ---------- Điều hướng ---------- */

    function goNext() {
        if (!canAdvance(state)) return;
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
        if (missingRows(state, catalog).length > 0) {
            alertUser('Còn sản phẩm không đủ tồn trên toàn hệ thống. Hãy giảm số lượng hoặc nhập thêm kho.');
            return;
        }

        state.submitting = true;
        render();
        try {
            const data = await apiPost('/api/warehouse/service-orders', { ...buildPayload(state), submit: true });
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

    /* ---------- Khung ---------- */

    function renderStepBody() {
        switch (state.step) {
            case 0:
                return branchPicker({
                    selected: state.branch,
                    onSelect: code => { state.branch = code; persist(); render(); }
                });
            case 1:
                return renderCustomerStep({ state, suggestionSlot, onChange: onCustomerChange });
            case 2:
                return renderServiceStep({ catalog, state, onToggle: actions.toggleService });
            case 3:
                return renderProductStep({ state, catalog, actions });
            default:
                return renderConfirmStep({ state, catalog });
        }
    }

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
                    disabled: !canAdvance(state),
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
                    ['Tổng số lượng', String(totalQty(state))]
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
