/**
 * Tab 3 — Sửa / Hủy: tìm lịch theo số điện thoại rồi sửa giờ hoặc hủy.
 *
 * Quy tắc giữ nguyên bản cũ:
 *  - Lịch đã qua giờ mà khách chưa đến  -> không cho sửa/hủy
 *  - Chỉ lịch ACTIVE mới có nút Sửa/Hủy (ARRIVED thì khách đã đến rồi)
 *  - Nhóm tour có thêm nút "Cập nhật" mở lại tab Thêm ở chế độ cập nhật
 *  - Mở tab mà chưa gõ SĐT thì tự tìm lịch gần đây
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { searchByPhone, editSchedule, cancelSchedule } from '../data/schedule-repo.js';
import { formatDateTime, toDateTimeLocal, isLocked } from '../domain/schedule-rules.js';
import {
    card, loader, emptyText, timelineItem, button, textInput, field,
    createAlert, createModal
} from '../ui/components.js';

const CANCEL_REASONS = [
    '',
    'Khách bom lịch (Không nghe, chặn số)',
    'Bận đột xuất / Xin dời ngày',
    'Chưa đủ tài chính / Chê đắt',
    'Đã qua cơ sở khác làm',
    'Lý do khác (Gõ chi tiết)'
];
const OTHER_REASON = 'Lý do khác (Gõ chi tiết)';

export function createEditTab({ isTour, onChanged }) {
    const alert = createAlert();
    const phoneInput = textInput({ type: 'tel', placeholder: 'Nhập SĐT khách hàng...' });
    const results = h('div');

    /* ---------- Hộp thoại hủy ---------- */

    const cancelOther = textInput({ placeholder: 'Gõ lý do khác vào đây...' });
    cancelOther.style.display = 'none';
    cancelOther.style.marginTop = '10px';

    const cancelSelect = h('select', {
        class: 'form-control',
        onChange: event => {
            cancelOther.style.display = event.target.value === OTHER_REASON ? 'block' : 'none';
        }
    }, CANCEL_REASONS.map(reason =>
        h('option', { value: reason }, reason || '-- Chọn lý do --')));

    let cancelId = null;
    const cancelModal = createModal({
        title: 'Xác nhận Hủy Lịch',
        footer: [
            button({ label: 'Đóng', variant: 'muted', onClick: () => cancelModal.close() }),
            button({ label: 'Hủy Lịch', variant: 'danger', onClick: () => confirmCancel() })
        ]
    });
    cancelModal.setBody(field({ label: 'Lý do hủy (bắt buộc):', input: cancelSelect }), cancelOther);

    function openCancel(id) {
        cancelId = id;
        cancelSelect.value = '';
        cancelOther.value = '';
        cancelOther.style.display = 'none';
        cancelModal.open();
    }

    async function confirmCancel() {
        const reason = cancelSelect.value === OTHER_REASON ? cancelOther.value : cancelSelect.value;
        if (!reason) {
            alert.show('Vui lòng chọn hoặc nhập lý do hủy!');
            return;
        }
        try {
            const data = await cancelSchedule({ id: cancelId, cancel_reason: reason });
            if (data.success) {
                cancelModal.close();
                search();
                alert.show('Đã hủy lịch thành công!', false);
            }
        } catch (_) {
            alert.show('Lỗi hệ thống');
        }
    }

    /* ---------- Hộp thoại sửa giờ ---------- */

    const editName = textInput({});
    const editTime = textInput({ type: 'datetime-local' });
    let editId = null;

    const editModal = createModal({
        title: 'Sửa Lịch Hẹn',
        footer: [
            button({ label: 'Đóng', variant: 'muted', onClick: () => editModal.close() }),
            button({ label: 'Lưu Thay Đổi', onClick: () => confirmEdit() })
        ]
    });
    editModal.setBody(
        field({ label: 'Tên Khách Hàng', input: editName }),
        field({ label: 'Ngày Giờ (Cách nhau >= 1 tiếng)', input: editTime })
    );

    function openEdit(item) {
        editId = item.id;
        editName.value = item.customer_name;
        editTime.value = toDateTimeLocal(item.appointment_time);
        editModal.open();
    }

    async function confirmEdit() {
        try {
            const data = await editSchedule({
                id: editId,
                customer_name: editName.value,
                appointment_time: editTime.value,
                phone: phoneInput.value
            });
            if (data.success) {
                editModal.close();
                search();
                alert.show('Đã lưu thay đổi!', false);
                onChanged();
                return;
            }
            alert.show(data.error || 'Có lỗi xảy ra');
        } catch (_) {
            alert.show('Lỗi hệ thống');
        }
    }

    /* ---------- Kết quả tìm ---------- */

    function updateButton(item) {
        if (!isTour) return null;
        return button({
            label: '✏️ Cập nhật',
            size: 'sm',
            variant: 'update',
            onClick: () => {
                const params = new URLSearchParams(location.search);
                params.set('action', 'update');
                params.set('id', item.id);
                location.search = params.toString();
            }
        });
    }

    function actionsFor(item) {
        if (item.status !== 'ACTIVE' && item.status !== 'ARRIVED') {
            return h('span', { class: 'cancelled-note' }, `ĐÃ HỦY: ${item.cancel_reason || ''}`);
        }
        if (isLocked(item)) {
            const extra = updateButton(item);
            return h('div', null,
                h('span', { class: 'locked-note' }, '(Lịch đã qua - Không thể sửa/hủy)'),
                extra ? h('div', { style: { marginTop: '5px' } }, extra) : null
            );
        }
        return h('div', { class: 'action-row' },
            item.status === 'ACTIVE'
                ? button({ label: 'Sửa Giờ', size: 'sm', onClick: () => openEdit(item) })
                : null,
            item.status === 'ACTIVE'
                ? button({ label: 'Hủy Lịch', size: 'sm', variant: 'danger', onClick: () => openCancel(item.id) })
                : null,
            updateButton(item)
        );
    }

    function resultRow(item) {
        return timelineItem({
            stacked: true,
            children: [
                h('strong', null,
                    item.customer_name,
                    item.status === 'ARRIVED' ? h('span', { class: 'tag tag--ok' }, ' (Đã đến)') : null
                ),
                h('small', null, 'Hẹn lúc: ', h('b', null, formatDateTime(item.appointment_time))),
                h('small', null, `Phụ trách: ${item.employee_name}`),
                actionsFor(item)
            ]
        });
    }

    /**
     * @param {boolean} isDefault true = tự động mở tab, cho phép SĐT rỗng
     */
    async function search(isDefault = false) {
        const phone = phoneInput.value;
        if (!isDefault && !phone) {
            alert.show('Vui lòng nhập số điện thoại');
            return;
        }
        replaceChildren(results, loader('Đang tìm...'));
        try {
            const items = await searchByPhone(phone);
            replaceChildren(results,
                items.length ? items.map(resultRow) : emptyText('Không tìm thấy lịch nào!')
            );
        } catch (_) {
            replaceChildren(results, emptyText('Lỗi kết nối!', 'bad'));
        }
    }

    const node = h('div', null,
        card(
            alert.node,
            h('div', { class: 'search-box' },
                phoneInput,
                button({ label: 'Tìm', size: 'sm', style: { width: '80px' }, onClick: () => search(false) })
            ),
            results
        ),
        cancelModal.node,
        editModal.node
    );

    return {
        node,
        /** Mở tab mà chưa gõ SĐT thì tự tìm lịch gần đây, giống bản cũ. */
        onOpen: () => { if (!phoneInput.value) search(true); }
    };
}
