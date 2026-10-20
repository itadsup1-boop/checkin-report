/**
 * Luồng chỉnh sửa đơn xuất kho khách hàng trong vòng 24h.
 * Tải chi tiết đơn, kiểm tra thời gian hiệu lực và phân quyền,
 * cho phép điều chỉnh số lượng/xóa món và gửi cập nhật an toàn.
 */

import { h, replaceChildren, cx } from '../../../shared-ui/core/dom.js';
import { apiGet, apiPost } from '../../../shared-ui/core/api.js';
import { alertUser, notifySuccess, notifyError, tapFeedback } from '../../../shared-ui/core/telegram.js';
import { topBar, bottomBar, primaryButton, notice, card, textField, emptyState } from '../ui/components.js';

function formatDateTime(isoString) {
    if (!isoString) return '';
    try {
        const d = new Date(isoString);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes} ${day}/${month}`;
    } catch {
        return isoString;
    }
}

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

    // State cho danh sách đơn có thể sửa
    let ordersList = [];
    let loadingList = !initialOrderId;
    let filterText = '';
    let activeTab = 'valid'; // 'valid' | 'all'
    let manualInputVal = '';
    let showManualInput = false;

    function initEdits(items) {
        itemEdits.clear();
        for (const item of items) {
            itemEdits.set(item.id, {
                quantity: Number(item.actual_quantity) || 0,
                isRemoved: Boolean(item.is_removed)
            });
        }
    }

    async function fetchOrderList() {
        loadingList = true;
        render();
        try {
            const res = await apiGet('/api/warehouse/order-edit/list', { type: 'EXPORT' });
            ordersList = res.orders || [];
        } catch (err) {
            console.error('[EditOrderFlow] list fetch failed', err);
            ordersList = [];
        } finally {
            loadingList = false;
            render();
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
    } else {
        fetchOrderList();
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

    function renderOrderListScreen() {
        const validOrders = ordersList.filter(o => o.is_within_24h);
        const validCount = validOrders.length;
        const allCount = ordersList.length;

        const filtered = ordersList.filter(o => {
            if (activeTab === 'valid' && !o.is_within_24h) return false;
            if (!filterText) return true;
            const q = filterText.toLowerCase();
            const matchCode = o.order_code && o.order_code.toLowerCase().includes(q);
            const matchCust = o.customer_name && o.customer_name.toLowerCase().includes(q);
            const matchPhone = o.customer_phone && String(o.customer_phone).includes(q);
            const matchBranch = o.branch && o.branch.toLowerCase().includes(q);
            const matchCreator = o.creator_name && o.creator_name.toLowerCase().includes(q);
            const matchItems = o.items_preview && o.items_preview.some(item =>
                item.product_name && item.product_name.toLowerCase().includes(q)
            );
            return matchCode || matchCust || matchPhone || matchBranch || matchCreator || matchItems;
        });

        return h('div', { class: 'app__body', style: { padding: '16px' } },
            notice('info', 'Chỉ được sửa các đơn xuất kho được tạo trong vòng 24 giờ.'),

            // Thanh tìm kiếm nhanh
            h('div', { style: { marginTop: '12px' } },
                textField({
                    label: 'Tìm kiếm đơn xuất',
                    placeholder: 'Tên khách, SĐT, mã đơn, sản phẩm...',
                    value: filterText,
                    onInput: v => {
                        filterText = v.trim();
                        render();
                    }
                })
            ),

            // Nút chuyển tab
            h('div', { style: { display: 'flex', gap: '8px', margin: '12px 0' } },
                h('button', {
                    type: 'button',
                    class: cx('btn', activeTab === 'valid' ? 'btn--primary' : 'btn--alt'),
                    style: { flex: '1', fontSize: '13px', padding: '8px 10px' },
                    onClick: () => { activeTab = 'valid'; render(); }
                }, `Đơn trong 24h (${validCount})`),
                h('button', {
                    type: 'button',
                    class: cx('btn', activeTab === 'all' ? 'btn--primary' : 'btn--alt'),
                    style: { flex: '1', fontSize: '13px', padding: '8px 10px' },
                    onClick: () => { activeTab = 'all'; render(); }
                }, `Tất cả gần đây (${allCount})`)
            ),

            // Danh sách đơn hoặc trạng thái rỗng
            loadingList
                ? h('div', { class: 'screen-center', style: { padding: '32px 0' } },
                    h('div', { class: 'spinner', style: { marginBottom: '12px' } }),
                    h('div', { class: 'strong', style: { fontSize: '13px', color: 'var(--muted)' } }, 'Đang tải danh sách đơn xuất...')
                )
                : (filtered.length === 0
                    ? h('div', { style: { padding: '16px 0' } },
                        activeTab === 'valid' && validCount === 0
                            ? h('div', null,
                                emptyState('Không có đơn xuất nào được tạo trong vòng 24 giờ qua.'),
                                allCount > 0 ? h('div', { style: { marginTop: '12px', textAlign: 'center' } },
                                    primaryButton({
                                        label: `Xem ${allCount} đơn gần đây`,
                                        variant: 'alt',
                                        onClick: () => { activeTab = 'all'; render(); }
                                    })
                                ) : null
                            )
                            : emptyState(filterText ? 'Không tìm thấy đơn nào khớp với từ khóa.' : 'Danh sách trống.')
                    )
                    : h('div', { class: 'stack', style: { gap: '10px' } },
                        filtered.map(order => {
                            const itemsSummary = (order.items_preview || [])
                                .map(i => `${i.product_name} (x${i.actual_quantity})`)
                                .join(', ');

                            return card({
                                body: h('div', {
                                    style: { cursor: order.is_within_24h ? 'pointer' : 'default' },
                                    onClick: () => {
                                        if (order.is_within_24h) {
                                            tapFeedback();
                                            fetchOrderDetail(order.id);
                                        } else {
                                            alertUser(`Đơn này đã tạo hơn 24 giờ trước (${Math.abs(order.hours_remaining)}h trước) nên không thể sửa đổi.`);
                                        }
                                    }
                                },
                                    h('div', { class: 'row-between', style: { marginBottom: '6px', alignItems: 'center' } },
                                        h('span', { style: { fontWeight: '700', fontSize: '14px', color: 'var(--brand)' } }, order.order_code),
                                        order.is_within_24h
                                            ? h('span', {
                                                style: {
                                                    background: 'var(--ok-soft)',
                                                    color: 'var(--ok)',
                                                    border: '1px solid var(--ok-line)',
                                                    fontSize: '11px',
                                                    fontWeight: '700',
                                                    padding: '2px 8px',
                                                    borderRadius: 'var(--r-full)'
                                                }
                                            }, `⏳ Còn ${order.hours_remaining}h`)
                                            : h('span', {
                                                style: {
                                                    background: 'var(--alt-soft)',
                                                    color: 'var(--muted)',
                                                    fontSize: '11px',
                                                    padding: '2px 8px',
                                                    borderRadius: 'var(--r-full)'
                                                }
                                            }, '⛔ Quá 24h')
                                    ),
                                    h('div', { style: { fontSize: '13px', marginBottom: '4px' } },
                                        h('span', { class: 'hint' }, 'Khách: '),
                                        h('b', null, order.customer_name || 'Khách lẻ'),
                                        order.customer_phone ? ` (${order.customer_phone})` : ''
                                    ),
                                    h('div', { style: { fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' } },
                                        `Cơ sở: ${order.branch} • Tạo bởi: ${order.creator_name || 'Nhân viên'} • ${formatDateTime(order.created_at)}`
                                    ),
                                    itemsSummary ? h('div', {
                                        style: {
                                            fontSize: '12px',
                                            background: 'var(--surface)',
                                            padding: '6px 10px',
                                            borderRadius: 'var(--r-sm)',
                                            marginBottom: '8px',
                                            color: 'var(--ink)'
                                        }
                                    }, `📦 ${itemsSummary}`) : null,
                                    order.is_within_24h
                                        ? h('div', { style: { textAlign: 'right', marginTop: '4px' } },
                                            h('span', { style: { fontSize: '13px', fontWeight: '700', color: 'var(--brand)' } }, '✏️ Chạm để sửa đơn →')
                                        )
                                        : h('div', { style: { fontSize: '11px', color: 'var(--faint)', fontStyle: 'italic' } },
                                            'Đã quá thời hạn 24h chỉnh sửa'
                                        )
                                )
                            });
                        })
                    )
                ),

            // Tra cứu thủ công nếu có mã riêng
            h('div', { style: { marginTop: '16px', paddingTop: '12px', borderTop: '1px dashed var(--line)' } },
                h('button', {
                    type: 'button',
                    class: 'btn btn--ghost',
                    style: { width: '100%', fontSize: '12px', color: 'var(--muted)' },
                    onClick: () => { showManualInput = !showManualInput; render(); }
                }, showManualInput ? '▲ Ẩn nhập mã thủ công' : '▼ Hoặc nhập mã đơn thủ công'),
                showManualInput ? h('div', { style: { marginTop: '12px' } },
                    textField({
                        label: 'Nhập mã đơn hoặc ID đơn xuất',
                        placeholder: 'Ví dụ: ORD-20261004-..., hoặc UUID đơn',
                        value: manualInputVal,
                        onInput: v => { manualInputVal = v.trim(); }
                    }),
                    h('div', { style: { marginTop: '10px' } },
                        primaryButton({
                            label: '🔍 Tìm đơn',
                            onClick: () => {
                                if (!manualInputVal) {
                                    alertUser('Vui lòng nhập mã đơn xuất cần sửa.');
                                    return;
                                }
                                fetchOrderDetail(manualInputVal);
                            }
                        })
                    )
                ) : null
            )
        );
    }

    function renderDoneScreen() {
        return h('div', { class: 'app__body', style: { padding: '24px 16px', textAlign: 'center' } },
            h('div', { style: { fontSize: '48px', marginBottom: '12px' } }, '✅'),
            h('div', { style: { fontSize: '18px', fontWeight: '800', marginBottom: '8px' } }, 'Đã sửa đơn thành công!'),
            h('div', { style: { fontSize: '13px', color: 'var(--muted)', marginBottom: '24px' } },
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
                        order.edit_count > 0 ? h('div', { style: { color: 'var(--brand)' } }, `✏️ Đã sửa ${order.edit_count} lần`) : null
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
                                        h('div', { style: { fontSize: '12px', color: 'var(--muted)' } },
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
            subtitle: data?.order?.order_code || (orderId ? orderId : 'Trong vòng 24 giờ'),
            onBack: () => {
                if (data || error) {
                    data = null;
                    orderId = '';
                    error = null;
                    if (ordersList.length === 0) {
                        fetchOrderList();
                    } else {
                        render();
                    }
                } else {
                    onExit();
                }
            }
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
                    primaryButton({ label: 'Quay lại danh sách đơn', onClick: () => { error = null; orderId = ''; render(); } })
                )
            ));
            return;
        }

        if (!data) {
            root.appendChild(renderOrderListScreen());
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
