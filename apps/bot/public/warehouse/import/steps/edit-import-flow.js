/**
 * Màn hình chỉnh sửa giao dịch nhập kho trong vòng 24h.
 * Tải chi tiết giao dịch, kiểm tra thời gian 24h và phân quyền,
 * kiểm tra tồn kho chống âm khi giảm số lượng, và cập nhật sổ cái.
 */

import { h, replaceChildren, cx } from '../../../shared-ui/core/dom.js';
import { apiGet, apiPost } from '../../../shared-ui/core/api.js';
import { alertUser, notifySuccess, notifyError, tapFeedback } from '../../../shared-ui/core/telegram.js';
import { topBar, bottomBar, button, notice, card, textField, emptyState } from '../ui/components.js';

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

export function createEditImportFlow({ initialTransactionId, onExit }) {
    const root = h('div', { class: 'flow-root', style: { display: 'contents' } });

    let transactionId = initialTransactionId || '';
    let loading = Boolean(initialTransactionId);
    let error = null;
    let data = null; // { transaction, currentStock, windowCheck, authCheck, canEdit }
    let editReason = '';
    let newQuantity = 0;
    let submitting = false;
    let submitted = false;

    // State cho danh sách phiếu có thể sửa
    let transactionsList = [];
    let loadingList = !initialTransactionId;
    let filterText = '';
    let activeTab = 'valid'; // 'valid' | 'all'
    let manualInputVal = '';
    let showManualInput = false;

    async function fetchTransactionList() {
        loadingList = true;
        render();
        try {
            const res = await apiGet('/api/warehouse/order-edit/list', { type: 'IMPORT' });
            transactionsList = res.orders || [];
        } catch (err) {
            console.error('[EditImportFlow] list fetch failed', err);
            transactionsList = [];
        } finally {
            loadingList = false;
            render();
        }
    }

    async function fetchTransactionDetail(idToFetch) {
        loading = true;
        error = null;
        render();
        try {
            const res = await apiGet('/api/warehouse/order-edit/detail', {
                type: 'IMPORT',
                id: idToFetch
            });
            data = res;
            transactionId = res.transaction.id;
            newQuantity = Number(res.transaction.quantity) || 0;
        } catch (err) {
            error = err.message || 'Không thể tải thông tin giao dịch nhập.';
            data = null;
        } finally {
            loading = false;
            render();
        }
    }

    if (initialTransactionId) {
        fetchTransactionDetail(initialTransactionId);
    } else {
        fetchTransactionList();
    }

    async function handleSubmit() {
        if (!editReason.trim()) {
            alertUser('Vui lòng nhập lý do chỉnh sửa giao dịch.');
            return;
        }

        const oldQty = Number(data.transaction.quantity) || 0;
        const targetQty = Number(newQuantity);
        if (!Number.isFinite(targetQty) || targetQty <= 0) {
            alertUser('Số lượng mới phải lớn hơn 0.');
            return;
        }

        const delta = Number((targetQty - oldQty).toFixed(1));
        if (delta === 0) {
            alertUser('Số lượng không thay đổi.');
            return;
        }

        // Chống âm kho
        if (delta < 0) {
            const reduction = Math.abs(delta);
            const stock = Number(data.currentStock) || 0;
            if (stock < reduction) {
                alertUser(`Hàng đã xuất dùng, tồn kho hiện tại chỉ còn ${stock} không đủ để giảm ${reduction}.`);
                return;
            }
        }

        tapFeedback();
        submitting = true;
        render();

        try {
            await apiPost('/api/warehouse/order-edit/import', {
                transaction_id: transactionId,
                edit_reason: editReason.trim(),
                new_quantity: targetQty
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

    function renderImportListScreen() {
        const validTrans = transactionsList.filter(t => t.is_within_24h);
        const validCount = validTrans.length;
        const allCount = transactionsList.length;

        const filtered = transactionsList.filter(t => {
            if (activeTab === 'valid' && !t.is_within_24h) return false;
            if (!filterText) return true;
            const q = filterText.toLowerCase();
            const matchId = t.id && t.id.toLowerCase().includes(q);
            const matchProd = t.product_name && t.product_name.toLowerCase().includes(q);
            const matchBarcode = t.barcode && String(t.barcode).toLowerCase().includes(q);
            const matchBranch = t.branch && t.branch.toLowerCase().includes(q);
            const matchCreator = t.creator_name && t.creator_name.toLowerCase().includes(q);
            return matchId || matchProd || matchBarcode || matchBranch || matchCreator;
        });

        return h('div', { class: 'body', style: { padding: '16px' } },
            notice('info', 'Chỉ được sửa các phiếu nhập kho được tạo trong vòng 24 giờ.'),

            // Thanh tìm kiếm nhanh
            h('div', { style: { marginTop: '12px' } },
                textField({
                    label: 'Tìm kiếm phiếu nhập',
                    placeholder: 'Tên SP, mã vạch, mã phiếu...',
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
                    class: cx('btn', activeTab === 'valid' ? 'btn--brand' : 'btn--alt'),
                    style: { flex: '1', fontSize: '13px', padding: '8px 10px' },
                    onClick: () => { activeTab = 'valid'; render(); }
                }, `Phiếu trong 24h (${validCount})`),
                h('button', {
                    type: 'button',
                    class: cx('btn', activeTab === 'all' ? 'btn--brand' : 'btn--alt'),
                    style: { flex: '1', fontSize: '13px', padding: '8px 10px' },
                    onClick: () => { activeTab = 'all'; render(); }
                }, `Tất cả gần đây (${allCount})`)
            ),

            // Danh sách phiếu nhập
            loadingList
                ? h('div', { class: 'screen-center', style: { padding: '32px 0' } },
                    h('div', { class: 'spinner', style: { marginBottom: '12px' } }),
                    h('div', { class: 'strong', style: { fontSize: '13px', color: 'var(--muted)' } }, 'Đang tải danh sách phiếu nhập...')
                )
                : (filtered.length === 0
                    ? h('div', { style: { padding: '16px 0' } },
                        activeTab === 'valid' && validCount === 0
                            ? h('div', null,
                                emptyState('Không có phiếu nhập nào được tạo trong vòng 24 giờ qua.'),
                                allCount > 0 ? h('div', { style: { marginTop: '12px', textAlign: 'center' } },
                                    button({
                                        label: `Xem ${allCount} phiếu gần đây`,
                                        variant: 'alt',
                                        onClick: () => { activeTab = 'all'; render(); }
                                    })
                                ) : null
                            )
                            : emptyState(filterText ? 'Không tìm thấy phiếu nào khớp với từ khóa.' : 'Danh sách trống.')
                    )
                    : h('div', { class: 'stack', style: { gap: '10px' } },
                        filtered.map(trans => {
                            const code = trans.id.slice(0, 8).toUpperCase();
                            return card({
                                body: h('div', {
                                    style: { cursor: trans.is_within_24h ? 'pointer' : 'default' },
                                    onClick: () => {
                                        if (trans.is_within_24h) {
                                            tapFeedback();
                                            fetchTransactionDetail(trans.id);
                                        } else {
                                            alertUser(`Phiếu này đã tạo hơn 24 giờ trước (${Math.abs(trans.hours_remaining)}h trước) nên không thể sửa đổi.`);
                                        }
                                    }
                                },
                                    h('div', { class: 'row-between', style: { marginBottom: '6px', alignItems: 'center' } },
                                        h('span', { style: { fontWeight: '700', fontSize: '14px', color: 'var(--brand)' } }, `#${code}`),
                                        trans.is_within_24h
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
                                            }, `⏳ Còn ${trans.hours_remaining}h`)
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
                                    h('div', { style: { fontSize: '14px', fontWeight: '600', marginBottom: '4px' } }, trans.product_name),
                                    h('div', { style: { fontSize: '13px', color: 'var(--brand)', marginBottom: '4px' } },
                                        h('span', { class: 'hint' }, 'Đã nhập: '),
                                        h('b', null, trans.quantity), ` ${trans.base_unit || ''}`
                                    ),
                                    h('div', { style: { fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' } },
                                        `Cơ sở: ${trans.branch} • Mã vạch: ${trans.barcode || '---'} • Người nhập: ${trans.creator_name || 'Nhân viên'} • ${formatDateTime(trans.created_at)}`
                                    ),
                                    trans.is_within_24h
                                        ? h('div', { style: { textAlign: 'right', marginTop: '4px' } },
                                            h('span', { style: { fontSize: '13px', fontWeight: '700', color: 'var(--brand)' } }, '✏️ Chạm để sửa số lượng →')
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
                }, showManualInput ? '▲ Ẩn nhập mã thủ công' : '▼ Hoặc nhập mã phiếu thủ công'),
                showManualInput ? h('div', { style: { marginTop: '12px' } },
                    textField({
                        label: 'Nhập mã phiếu hoặc ID giao dịch nhập',
                        placeholder: 'Ví dụ: 8 ký tự mã phiếu hoặc UUID',
                        value: manualInputVal,
                        onInput: v => { manualInputVal = v.trim(); }
                    }),
                    h('div', { style: { marginTop: '10px' } },
                        button({
                            label: '🔍 Tìm phiếu nhập',
                            onClick: () => {
                                if (!manualInputVal) {
                                    alertUser('Vui lòng nhập mã giao dịch nhập cần sửa.');
                                    return;
                                }
                                fetchTransactionDetail(manualInputVal);
                            }
                        })
                    )
                ) : null
            )
        );
    }

    function renderDoneScreen() {
        return h('div', { class: 'body', style: { padding: '24px 16px', textAlign: 'center' } },
            h('div', { style: { fontSize: '48px', marginBottom: '12px' } }, '✅'),
            h('div', { style: { fontSize: '18px', fontWeight: '800', marginBottom: '8px' } }, 'Đã sửa phiếu nhập thành công!'),
            h('div', { style: { fontSize: '13px', color: 'var(--muted)', marginBottom: '24px' } },
                'Tồn kho và sổ cái đã được cập nhật bù trừ. Báo cáo Google Sheet đã được tự động làm mới.'
            ),
            button({
                label: 'Quay lại màn hình chính',
                onClick: onExit
            })
        );
    }

    function renderDetailScreen() {
        const tx = data.transaction;
        const currentStock = Number(data.currentStock) || 0;
        const windowCheck = data.windowCheck;
        const authCheck = data.authCheck;
        const canEdit = data.canEdit;

        const oldQty = Number(tx.quantity) || 0;
        const delta = Number((newQuantity - oldQty).toFixed(1));
        const sign = delta > 0 ? '+' : '';
        const hasChanges = delta !== 0;

        return h('div', { class: 'body', style: { padding: '12px 16px 80px' } },
            // Cảnh báo hạn 24h & quyền
            windowCheck.allowed
                ? notice('ok', `⏳ Phiếu trong hạn 24h (còn khoảng ${windowCheck.hoursRemaining} giờ để chỉnh sửa).`)
                : notice('bad', `⛔ ${windowCheck.message}`),

            !authCheck.allowed
                ? h('div', { style: { marginTop: '8px' } }, notice('bad', authCheck.message))
                : null,

            // Thông tin phiếu
            h('div', { style: { marginTop: '12px' } },
                card({
                    title: `Phiếu nhập: ${tx.id.slice(0, 8).toUpperCase()}`,
                    body: h('div', { class: 'stack', style: { gap: '6px', fontSize: '13px' } },
                        h('div', null, h('span', { class: 'hint' }, 'Sản phẩm: '), h('b', null, tx.product_name)),
                        h('div', null, h('span', { class: 'hint' }, 'Mã vạch: '), tx.barcode || 'Chưa có'),
                        h('div', null, h('span', { class: 'hint' }, 'Cơ sở: '), h('b', null, tx.branch)),
                        h('div', null, h('span', { class: 'hint' }, 'Người nhập: '), tx.creator_name || 'Nhân viên'),
                        h('div', null, h('span', { class: 'hint' }, 'Tồn kho hiện tại: '), h('b', null, currentStock), ` ${tx.base_unit || 'đơn vị'}`),
                        tx.edit_count > 0 ? h('div', { style: { color: 'var(--brand)' } }, `✏️ Đã sửa ${tx.edit_count} lần`) : null
                    )
                })
            ),

            // Điều chỉnh số lượng
            h('div', { style: { marginTop: '16px' } },
                card({
                    title: 'Điều chỉnh số lượng nhập',
                    body: h('div', null,
                        h('div', { class: 'row-between', style: { alignItems: 'center' } },
                            h('div', null,
                                h('div', { style: { fontSize: '13px', color: 'var(--muted)' } }, `Số lượng đã nhập: ${oldQty}`),
                                delta !== 0 ? h('div', {
                                    style: {
                                        fontWeight: '800',
                                        fontSize: '13px',
                                        marginTop: '4px',
                                        color: delta > 0 ? 'var(--ok)' : 'var(--warn)'
                                    }
                                }, `Thay đổi: ${oldQty} ➔ ${newQuantity} (${sign}${delta})`) : null
                            ),
                            canEdit ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                                h('button', {
                                    type: 'button',
                                    class: 'btn btn--dark btn--compact',
                                    style: { width: '32px', height: '32px', padding: 0 },
                                    onClick: () => {
                                        newQuantity = Math.max(1, Number((newQuantity - 1).toFixed(1)));
                                        render();
                                    }
                                }, '-'),
                                h('input', {
                                    type: 'number',
                                    step: 'any',
                                    class: 'field__input',
                                    style: { width: '64px', textAlign: 'center', padding: '4px' },
                                    value: newQuantity,
                                    onInput: e => {
                                        newQuantity = Math.max(0, Number(e.target.value) || 0);
                                        render();
                                    }
                                }),
                                h('button', {
                                    type: 'button',
                                    class: 'btn btn--dark btn--compact',
                                    style: { width: '32px', height: '32px', padding: 0 },
                                    onClick: () => {
                                        newQuantity = Number((newQuantity + 1).toFixed(1));
                                        render();
                                    }
                                }, '+')
                            ) : null
                        )
                    )
                })
            ),

            // Nhập lý do sửa
            canEdit ? h('div', { style: { marginTop: '16px' } },
                textField({
                    label: 'Lý do chỉnh sửa (*bắt buộc)',
                    placeholder: 'Ví dụ: Nhập nhầm số lượng, nhà cung cấp giao thiếu...',
                    value: editReason,
                    onInput: v => { editReason = v; }
                })
            ) : null
        );
    }

    function render() {
        replaceChildren(root);

        const header = topBar({
            title: 'Sửa phiếu nhập kho',
            subtitle: data?.transaction ? data.transaction.id.slice(0, 8).toUpperCase() : (transactionId ? transactionId.slice(0, 8).toUpperCase() : 'Trong vòng 24 giờ'),
            onBack: () => {
                if (data || error) {
                    data = null;
                    transactionId = '';
                    error = null;
                    if (transactionsList.length === 0) {
                        fetchTransactionList();
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
                h('div', { class: 'strong' }, 'Đang kiểm tra phiếu nhập…')
            ));
            return;
        }

        if (error) {
            root.appendChild(h('div', { class: 'body', style: { padding: '16px' } },
                notice('bad', error),
                h('div', { style: { marginTop: '16px' } },
                    button({ label: 'Quay lại danh sách phiếu', onClick: () => { error = null; transactionId = ''; render(); } })
                )
            ));
            return;
        }

        if (!data) {
            root.appendChild(renderImportListScreen());
            return;
        }

        root.appendChild(renderDetailScreen());

        if (data.canEdit) {
            const oldQty = Number(data.transaction.quantity) || 0;
            const delta = Number((newQuantity - oldQty).toFixed(1));
            const hasChanges = delta !== 0;

            root.appendChild(bottomBar(
                button({
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
