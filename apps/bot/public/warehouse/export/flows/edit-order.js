/**
 * Luồng chỉnh sửa đơn xuất kho khách hàng trong vòng 24h.
 * Tải chi tiết đơn, kiểm tra thời gian hiệu lực và phân quyền,
 * cho phép điều chỉnh số lượng/xóa món và gửi cập nhật an toàn.
 */

import { h, replaceChildren, cx } from '../../../../shared-ui/core/dom.js';
import { apiGet, apiPost } from '../../../../shared-ui/core/api.js';
import { alertUser, notifySuccess, notifyError, tapFeedback } from '../../../../shared-ui/core/telegram.js';
import { topBar, bottomBar, primaryButton, notice, card, textField, emptyState } from '../ui/components.js';

export function createEditOrderFlow({ catalog, initialOrderId, onExit }) {
    const root = h('div', { class: 'flow-root', style: { display: 'contents' } });

    let orderId = initialOrderId || '';
    let loading = Boolean(initialOrderId);
    let error = null;
    let data = null; // { order, items, stockMap, windowCheck, authCheck, canEdit }
    let editReason = '';
    let itemEdits = new Map(); // itemId -> { quantity, isRemoved }
    let submitting = false;
    let submitted = false;

    function initEdits(items) {
        itemEdits.clear();
        for (const item of items) {
            itemEdits.set(item.id, {
                quantity: Number(item.actual_quantity) || 0,
                isRemoved: Boolean(item.is_removed)
            });
        }
    }

    async function fetchOrderDetail(idToFetch) {
        loading = true;
        error = null;
        render();
        try {
            const res = await apiGet('/api/warehouse/order-edit/detail', {
                type: 'EXPORT',
                id: idToFetch
            });
            data = res;
            orderId = res.order.id;
            initEdits(res.items);
        } catch (err) {
            error = err.message || 'Không thể tải thông tin đơn hàng.';
            data = null;
        } finally {
            loading = false;
            render();
        }
    }

    if (initialOrderId) {
        fetchOrderDetail(initialOrderId);
    }

    function calculateChanges() {
        if (!data || !data.items) return { deltas: [], hasChanges: false };
        const deltas = [];
        for (const item of data.items) {
            const edit = itemEdits.get(item.id) || { quantity: Number(item.actual_quantity) || 0, isRemoved: item.is_removed };
            const oldQty = Number(item.actual_quantity) || 0;
            const newQty = edit.isRemoved ? 0 : edit.quantity;
            const delta = Number((newQty - oldQty).toFixed(1));
            if (delta !== 0 || edit.isRemoved !== item.is_removed) {
                deltas.push({
                    id: item.id,
                    product_id: item.product_id,
                    product_name: item.product_name_snapshot,
                    oldQuantity: oldQty,
                    newQuantity: newQty,
                    delta,
                    is_removed: edit.isRemoved
                });
            }
        }
        return { deltas, hasChanges: deltas.length > 0 };
    }

    async function handleSubmit() {
        if (!editReason.trim()) {
            alertUser('Vui lòng nhập lý do chỉnh sửa đơn.');
            return;
        }

        const { deltas, hasChanges } = calculateChanges();
        if (!hasChanges) {
            alertUser('Bạn chưa thay đổi số lượng của mặt hàng nào.');
            return;
        }

        tapFeedback();
        submitting = true;
        render();

        try {
            const updatedItems = data.items.map(item => {
                const edit = itemEdits.get(item.id) || { quantity: item.actual_quantity, isRemoved: item.is_removed };
                return {
                    id: item.id,
                    product_id: item.product_id,
                    product_name: item.product_name_snapshot,
                    actual_quantity: edit.isRemoved ? 0 : edit.quantity,
                    is_removed: edit.isRemoved
                };
            });

            await apiPost('/api/warehouse/order-edit/export', {
                order_id: orderId,
                edit_reason: editReason.trim(),
                updated_items: updatedItems
            });

            notifySuccess();
            submitted = true;
        } catch (err) {
            notifyError();
            alertUser(err.message || 'Có lỗi xảy ra khi lưu thay đổi.');
        } finally {
            submitting = false;
            render();
        }
    }

    function renderLookupScreen() {
        let inputVal = '';
        return h('div', { class: 'app__body', style: { padding: '16px' } },
            notice('info', 'Chỉ được sửa các đơn xuất kho được tạo trong vòng 24 giờ.'),
            h('div', { style: { marginTop: '16px' } },
                textField({
                    label: 'Nhập mã đơn hoặc ID đơn xuất',
                    placeholder: 'Ví dụ: ORD-20261004-..., hoặc UUID đơn',
                    value: inputVal,
                    onInput: v => { inputVal = v.trim(); }
                }),
                h('div', { style: { marginTop: '16px' } },
                    primaryButton({
                        label: '🔍 Tìm đơn',
                        onClick: () => {
                            if (!inputVal) {
                                alertUser('Vui lòng nhập mã đơn xuất cần sửa.');
                                return;
                            }
                            fetchOrderDetail(inputVal);
                        }
                    })
                )
            )
        );
    }

    function renderDoneScreen() {
        return h('div', { class: 'app__body', style: { padding: '24px 16px', textAlign: 'center' } },
            h('div', { style: { fontSize: '48px', marginBottom: '12px' } }, '✅'),
            h('div', { style: { fontSize: '18px', fontWeight: '800', marginBottom: '8px' } }, 'Đã sửa đơn thành công!'),
            h('div', { style: { fontSize: '13px', color: 'var(--color-text-muted)', marginBottom: '24px' } },
                'Tồn kho và sổ cái đã được cập nhật bù trừ. Báo cáo Google Sheet và tin nhắn Telegram đã được tự động làm mới.'
            ),
            primaryButton({
                label: 'Quay lại màn hình chính',
                onClick: onExit
            })
        );
    }

    function renderDetailScreen() {
        const order = data.order;
        const items = data.items;
        const stockMap = data.stockMap || {};
        const windowCheck = data.windowCheck;
        const authCheck = data.authCheck;
        const canEdit = data.canEdit;

        const { deltas, hasChanges } = calculateChanges();

        return h('div', { class: 'app__body', style: { padding: '12px 16px 80px' } },
            // Cảnh báo hạn 24h & quyền
            windowCheck.allowed
                ? notice('ok', `⏳ Đơn trong hạn 24h (còn khoảng ${windowCheck.hoursRemaining} giờ để chỉnh sửa).`)
                : notice('bad', `⛔ ${windowCheck.message}`),

            !authCheck.allowed
                ? h('div', { style: { marginTop: '8px' } }, notice('bad', authCheck.message))
                : null,

            // Thông tin chung đơn
            h('div', { style: { marginTop: '12px' } },
                card({
                    title: `Đơn: ${order.order_code}`,
                    body: h('div', { class: 'stack', style: { gap: '6px', fontSize: '13px' } },
                        h('div', null, h('span', { class: 'hint' }, 'Khách: '), h('b', null, order.customer_name || 'Khách lẻ'), ' (', order.customer_phone || '', ')'),
                        h('div', null, h('span', { class: 'hint' }, 'Cơ sở: '), h('b', null, order.branch)),
                        h('div', null, h('span', { class: 'hint' }, 'Người tạo: '), order.creator_name || 'Nhân viên'),
                        order.edit_count > 0 ? h('div', { style: { color: 'var(--color-brand)' } }, `✏️ Đã sửa ${order.edit_count} lần`) : null
                    )
                })
            ),

            // Danh sách mặt hàng
            h('div', { style: { marginTop: '16px' } },
                h('div', { style: { fontSize: '14px', fontWeight: '800', marginBottom: '8px' } }, '📦 Danh sách mặt hàng xuất:'),
                items.length === 0 ? emptyState('Đơn không có mặt hàng nào.') : null,
                h('div', { class: 'stack', style: { gap: '10px' } },
                    items.map(item => {
                        const edit = itemEdits.get(item.id) || { quantity: Number(item.actual_quantity) || 0, isRemoved: item.is_removed };
                        const available = Number(stockMap[item.product_id]) || 0;
                        const oldQty = Number(item.actual_quantity) || 0;
                        const currentQty = edit.quantity;
                        const delta = edit.isRemoved ? -oldQty : Number((currentQty - oldQty).toFixed(1));

                        return card({
                            body: h('div', null,
                                h('div', { class: 'row-between', style: { marginBottom: '6px' } },
                                    h('div', null,
                                        h('div', { style: { fontWeight: '700', fontSize: '14px' } }, item.product_name_snapshot),
                                        h('div', { style: { fontSize: '12px', color: 'var(--color-text-muted)' } },
                                            `Hiện tại: ${oldQty} ${item.unit_snapshot || ''} | Tồn thêm tại cơ sở: ${available}`
                                        )
                                    ),
                                    delta !== 0 ? h('span', {
                                        style: {
                                            fontWeight: '800',
                                            fontSize: '13px',
                                            color: delta > 0 ? 'var(--ok)' : 'var(--warn)'
                                        }
                                    }, delta > 0 ? `+${delta}` : `${delta}`) : null
                                ),

                                canEdit ? h('div', { class: 'row-between', style: { alignItems: 'center', marginTop: '10px' } },
                                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                                        h('button', {
                                            type: 'button',
                                            class: 'btn btn--secondary btn--compact',
                                            style: { width: '32px', height: '32px', padding: 0 },
                                            onClick: () => {
                                                const next = Math.max(0, Number((currentQty - 1).toFixed(1)));
                                                itemEdits.set(item.id, { quantity: next, isRemoved: next === 0 });
                                                render();
                                            }
                                        }, '-'),
                                        h('input', {
                                            type: 'number',
                                            step: 'any',
                                            class: 'field__input',
                                            style: { width: '64px', textAlign: 'center', padding: '4px' },
                                            value: edit.isRemoved ? 0 : currentQty,
                                            disabled: edit.isRemoved,
                                            onInput: e => {
                                                const val = Math.max(0, Number(e.target.value) || 0);
                                                itemEdits.set(item.id, { quantity: val, isRemoved: val === 0 });
                                                render();
                                            }
                                        }),
                                        h('button', {
                                            type: 'button',
                                            class: 'btn btn--secondary btn--compact',
                                            style: { width: '32px', height: '32px', padding: 0 },
                                            onClick: () => {
                                                const next = Number((currentQty + 1).toFixed(1));
                                                itemEdits.set(item.id, { quantity: next, isRemoved: false });
                                                render();
                                            }
                                        }, '+')
                                    ),
                                    h('button', {
                                        type: 'button',
                                        class: cx('btn btn--compact', edit.isRemoved ? 'btn--primary' : 'btn--outline'),
                                        style: { fontSize: '11px', padding: '4px 8px' },
                                        onClick: () => {
                                            itemEdits.set(item.id, { quantity: currentQty, isRemoved: !edit.isRemoved });
                                            render();
                                        }
                                    }, edit.isRemoved ? 'Khôi phục' : 'Xoá món')
                                ) : null
                            )
                        });
                    })
                )
            ),

            // Nhập lý do sửa
            canEdit ? h('div', { style: { marginTop: '16px' } },
                textField({
                    label: 'Lý do chỉnh sửa (*bắt buộc)',
                    placeholder: 'Ví dụ: Khách đổi liệu trình, trả bớt hàng...',
                    value: editReason,
                    onInput: v => { editReason = v; }
                })
            ) : null
        );
    }

    function render() {
        replaceChildren(root);

        // Header
        const header = topBar({
            title: 'Sửa đơn xuất kho',
            subtitle: orderId ? (data?.order?.order_code || orderId) : 'Trong vòng 24 giờ',
            onBack: onExit
        });
        root.appendChild(header);

        if (submitted) {
            root.appendChild(renderDoneScreen());
            return;
        }

        if (loading) {
            root.appendChild(h('div', { class: 'screen-center' },
                h('div', { class: 'spinner', style: { marginBottom: '14px' } }),
                h('div', { class: 'strong' }, 'Đang kiểm tra đơn hàng…')
            ));
            return;
        }

        if (error) {
            root.appendChild(h('div', { class: 'app__body', style: { padding: '16px' } },
                notice('bad', error),
                h('div', { style: { marginTop: '16px' } },
                    primaryButton({ label: 'Nhập lại mã khác', onClick: () => { error = null; orderId = ''; render(); } })
                )
            ));
            return;
        }

        if (!data) {
            root.appendChild(renderLookupScreen());
            return;
        }

        root.appendChild(renderDetailScreen());

        if (data.canEdit) {
            const { hasChanges } = calculateChanges();
            root.appendChild(bottomBar(
                primaryButton({
                    label: submitting ? 'Đang lưu…' : (hasChanges ? 'Lưu chỉnh sửa' : 'Chưa có thay đổi'),
                    disabled: submitting || !hasChanges,
                    onClick: handleSubmit
                })
            ));
        }
    }

    render();
    return root;
}
