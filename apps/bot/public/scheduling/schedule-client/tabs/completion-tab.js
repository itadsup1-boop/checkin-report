/**
 * Hoàn tất lịch còn thiếu của nhóm Báo hẹn khách cũ (`report`).
 *
 * Nhân viên chỉ chọn lịch của chính mình trong 48 giờ gần nhất và bổ sung ảnh.
 * Dữ liệu khách/dịch vụ lấy nguyên từ lịch gốc; màn hình này không tạo lịch mới,
 * không sửa doanh thu và không liên quan tới cách tính công tour.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { loadIncompleteSchedules, uploadProof } from '../data/schedule-repo.js';
import { formatDateTime } from '../domain/schedule-rules.js';
import { toCompressedDataUrl, TASK_PHOTO_QUALITY } from '../media/photo.js';
import {
    card, sectionTitle, field, button, emptyText, createAlert
} from '../ui/components.js';

export function createCompletionTab() {
    const alert = createAlert();
    let schedules = [];
    let imageBase64 = '';

    const details = h('div', { class: 'history-body' },
        'Chọn một lịch để xem thông tin cần hoàn tất.');
    const select = h('select', {
        class: 'form-control',
        onChange: event => showDetails(event.target.value)
    }, h('option', { value: '' }, '-- Chọn lịch còn thiếu --'));

    function showDetails(id) {
        const item = schedules.find(row => String(row.id) === String(id));
        replaceChildren(details, item
            ? h('div', null,
                h('strong', null, item.customer_name || 'Khách chưa có tên'),
                h('div', null, `Giờ hẹn: ${formatDateTime(item.appointment_time)}`),
                h('div', null, `Dịch vụ: ${item.service || 'Chưa có'}`),
                h('div', null, item.status === 'ARRIVED'
                    ? 'Trạng thái: Khách đã đến, còn thiếu ảnh'
                    : 'Trạng thái: Chưa xác nhận hoàn tất'))
            : 'Chọn một lịch để xem thông tin cần hoàn tất.');
    }

    const photoStatus = h('span', { class: 'photo-status' }, 'Chưa chọn ảnh');
    const preview = h('img', { class: 'photo-preview' });
    const previewBox = h('div', { style: { marginTop: '10px', display: 'none' } }, preview);
    const photoInput = h('input', {
        type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden',
        onChange: async event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            photoStatus.textContent = 'Đang xử lý ảnh...';
            try {
                imageBase64 = await toCompressedDataUrl(file, TASK_PHOTO_QUALITY);
                preview.src = imageBase64;
                previewBox.style.display = 'block';
                photoStatus.textContent = '✅ Đã chọn ảnh';
            } catch (_) {
                imageBase64 = '';
                photoStatus.textContent = 'Ảnh không hợp lệ';
            }
        }
    });

    const submitButton = button({ label: 'HOÀN TẤT LỊCH', onClick: submit });

    async function submit() {
        if (!select.value) {
            alert.show('Vui lòng chọn lịch cần hoàn tất!');
            return;
        }
        if (!imageBase64) {
            alert.show('Vui lòng chọn ảnh minh chứng!');
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'ĐANG GỬI ẢNH...';
        try {
            const result = await uploadProof({ id: Number(select.value), imageBase64 });
            if (!result.success) {
                alert.show(result.error || 'Không thể hoàn tất lịch!');
                return;
            }
            alert.show('✅ Lịch đã được hoàn tất và ghi nhận ảnh minh chứng.', false);
            imageBase64 = '';
            previewBox.style.display = 'none';
            photoStatus.textContent = 'Chưa chọn ảnh';
            await reload();
        } catch (_) {
            alert.show('Lỗi kết nối hệ thống!');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'HOÀN TẤT LỊCH';
        }
    }

    async function reload() {
        replaceChildren(select, h('option', { value: '' }, '-- Đang tải lịch... --'));
        showDetails('');
        try {
            const result = await loadIncompleteSchedules();
            if (!result.success) throw new Error(result.error);
            schedules = result.data || [];
            replaceChildren(select,
                h('option', { value: '' }, schedules.length
                    ? '-- Chọn lịch còn thiếu --'
                    : '-- Không có lịch thiếu trong 48 giờ --'),
                schedules.map(item => h('option', { value: item.id },
                    `${item.customer_name} — ${formatDateTime(item.appointment_time)}`))
            );
        } catch (error) {
            schedules = [];
            replaceChildren(select, h('option', { value: '' }, error.message || 'Lỗi tải dữ liệu'));
        }
    }

    const node = h('div', null,
        card(
            sectionTitle('Hoàn Tất Lịch Còn Thiếu'),
            h('p', { class: 'history-reason' },
                'Bạn có 48 giờ từ giờ hẹn để bổ sung ảnh. Quá thời hạn, hãy nhờ Quản lý hoặc Admin xử lý.'),
            alert.node,
            field({ label: 'Lịch cần hoàn tất *', input: select }),
            details,
            h('div', { class: 'form-group', style: { marginTop: '18px', marginBottom: '20px' } },
                h('label', null, 'Ảnh minh chứng *'),
                h('div', { class: 'photo-row' },
                    button({
                        label: '📸 Chụp / Chọn ảnh', size: 'sm', variant: 'success',
                        style: { width: 'auto' }, onClick: () => photoInput.click()
                    }),
                    photoStatus
                ),
                photoInput,
                previewBox
            ),
            submitButton
        ),
        card(emptyText('Chỉ bổ sung ảnh cho lịch đã có; hệ thống không tạo lịch mới và không tính công tour.'))
    );

    let started = false;
    return {
        node,
        onOpen() {
            if (started) return;
            started = true;
            reload();
        }
    };
}
