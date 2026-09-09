/**
 * Tab 5 — Báo Bù Công Tour. CHỈ hiện với nhóm `report_tour`.
 *
 * Hai loại yêu cầu:
 *   EXISTING_APPOINTMENT — bổ sung lịch cũ còn thiếu ảnh / chưa hoàn thành.
 *       Chọn lịch từ danh sách, các ô thông tin bị KHOÁ và đổ theo lịch gốc để
 *       không ai sửa lệch so với lịch đã đăng ký.
 *   MISSING_APPOINTMENT — báo bù lịch chưa từng đăng ký, nhập tay toàn bộ.
 *
 * Ô Bác sĩ / Điều dưỡng luôn mở ở cả hai loại, và được nối vào phần lý do vì
 * bảng yêu cầu bù chưa có cột riêng cho hai trường này.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import {
    loadIncompleteSchedules, submitMakeupRequest, loadMakeupHistory
} from '../data/schedule-repo.js';
import {
    MAKEUP_EXISTING, MAKEUP_MISSING, MAKEUP_LOCKED_FIELDS,
    checkMakeupRequest, appendStaffToReason, makeupStatusLabel, requestTypeLabel,
    formatTime, formatDate, toDateTimeLocal
} from '../domain/schedule-rules.js';
import { toCompressedDataUrl, MAKEUP_PHOTO_QUALITY } from '../media/photo.js';
import {
    card, sectionTitle, field, textInput, selectInput, button,
    loader, emptyText, timelineItem, badge, createAlert
} from '../ui/components.js';

const REQUEST_TYPES = [
    { value: MAKEUP_EXISTING, label: 'Bổ sung lịch cũ (Thiếu ảnh/chưa hoàn thành)' },
    { value: MAKEUP_MISSING, label: 'Báo bù lịch mới chưa từng đăng ký' }
];
const SESSION_TYPES = [
    { value: 'Bán', label: 'Bán' },
    { value: 'Bảo hành', label: 'Bảo hành' },
    { value: 'Tặng', label: 'Tặng' }
];

export function createMakeupTab() {
    const alert = createAlert();
    let incomplete = [];
    let imageBase64 = '';

    const inputs = {
        customerName: textInput({ placeholder: 'Tên khách hàng' }),
        phone: textInput({ type: 'tel', placeholder: 'Số điện thoại' }),
        service: textInput({ placeholder: 'Tên dịch vụ' }),
        doctor: textInput({ placeholder: 'Tên bác sĩ (nếu có)' }),
        nurse: textInput({ placeholder: 'Tên điều dưỡng (nếu có)' }),
        sessions: textInput({ placeholder: 'VD: 1/10' }),
        sessionType: selectInput({ options: SESSION_TYPES, value: 'Bán' }),
        revenue: textInput({ placeholder: 'VD: 500k hoặc 0' }),
        appointmentTime: textInput({ type: 'datetime-local' }),
        reason: textInput({ rows: 3, placeholder: 'Nhập lý do chưa báo cáo hoặc lý do thiếu ảnh...' })
    };

    const originalSelect = h('select', {
        class: 'form-control',
        onChange: event => onSelectOriginal(event.target.value)
    }, h('option', { value: '' }, '-- Chọn lịch hẹn --'));

    const groupExisting = field({ label: 'Chọn Lịch Thiếu Cần Bổ Sung *', input: originalSelect });

    const requestType = selectInput({
        options: REQUEST_TYPES,
        value: MAKEUP_EXISTING,
        onChange: () => { toggleFields(); if (isExisting()) reloadIncomplete(); }
    });

    const isExisting = () => requestType.value === MAKEUP_EXISTING;

    /* ---------- Bật/tắt các ô theo loại yêu cầu ---------- */

    function toggleFields() {
        if (isExisting()) {
            groupExisting.style.display = 'block';
            for (const name of MAKEUP_LOCKED_FIELDS) inputs[name].disabled = true;
        } else {
            groupExisting.style.display = 'none';
            for (const name of MAKEUP_LOCKED_FIELDS) {
                inputs[name].disabled = false;
                inputs[name].value = '';
            }
            inputs.sessionType.value = 'Bán';
        }
        // Bác sĩ / điều dưỡng luôn cho nhập ở cả hai loại.
        inputs.doctor.disabled = false;
        inputs.nurse.disabled = false;
    }

    function onSelectOriginal(id) {
        if (!id) {
            toggleFields();
            return;
        }
        const item = incomplete.find(row => String(row.id) === String(id));
        if (!item) return;

        inputs.customerName.value = item.customer_name || '';
        inputs.phone.value = item.phone || '';
        inputs.service.value = item.service || '';
        inputs.sessions.value = item.sessions || '';
        inputs.sessionType.value = item.session_type || 'Bán';
        inputs.revenue.value = item.revenue || '';
        inputs.appointmentTime.value = toDateTimeLocal(item.appointment_time);
    }

    async function reloadIncomplete() {
        if (!isExisting()) return;
        replaceChildren(originalSelect, h('option', { value: '' }, '-- Đang tải lịch... --'));
        try {
            const result = await loadIncompleteSchedules();
            if (!result.success) {
                replaceChildren(originalSelect,
                    h('option', { value: '' }, result.error || 'Lỗi tải dữ liệu!'));
                return;
            }
            incomplete = result.data || [];
            if (incomplete.length === 0) {
                replaceChildren(originalSelect,
                    h('option', { value: '' }, '-- Không có lịch nào cần báo bù --'));
                return;
            }
            replaceChildren(originalSelect,
                h('option', { value: '' }, '-- Chọn lịch hẹn --'),
                incomplete.map(item => h('option', { value: item.id },
                    `${item.customer_name} (${formatTime(item.appointment_time)}`
                    + ` - ${item.status === 'ARRIVED' ? 'Thiếu ảnh' : 'Chưa đến'})`))
            );
        } catch (_) {
            replaceChildren(originalSelect, h('option', { value: '' }, 'Lỗi mạng!'));
        }
    }

    /* ---------- Ảnh minh chứng ---------- */

    const photoStatus = h('span', { class: 'photo-status' }, 'Chưa chọn ảnh');
    const photoPreview = h('img', { class: 'photo-preview' });
    const photoPreviewBox = h('div', { style: { marginTop: '10px', display: 'none' } }, photoPreview);

    const photoInput = h('input', {
        type: 'file', accept: 'image/*', class: 'hidden',
        onChange: async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            photoStatus.textContent = 'Đang xử lý ảnh...';
            try {
                imageBase64 = await toCompressedDataUrl(file, MAKEUP_PHOTO_QUALITY);
                photoPreview.src = imageBase64;
                photoPreviewBox.style.display = 'block';
                photoStatus.textContent = '✅ Đã chọn ảnh';
            } catch (_) {
                photoStatus.textContent = 'Ảnh không hợp lệ';
            }
        }
    });

    function resetPhoto() {
        imageBase64 = '';
        photoPreviewBox.style.display = 'none';
        photoStatus.textContent = 'Chưa chọn ảnh';
    }

    /* ---------- Gửi ---------- */

    const submitButton = button({ label: 'GỬI YÊU CẦU BÁO BÙ', onClick: () => submit() });

    async function submit() {
        const form = {
            request_type: requestType.value,
            original_appointment_id: originalSelect.value ? parseInt(originalSelect.value, 10) : null,
            appointment_time: inputs.appointmentTime.value,
            customer_name: inputs.customerName.value.trim(),
            phone: inputs.phone.value.trim(),
            service: inputs.service.value.trim(),
            sessions: inputs.sessions.value.trim(),
            session_type: inputs.sessionType.value,
            revenue: inputs.revenue.value.trim(),
            reason: inputs.reason.value.trim(),
            imageBase64
        };

        const verdict = checkMakeupRequest(form);
        if (!verdict.ok) {
            alert.show(verdict.message);
            return;
        }

        form.reason = appendStaffToReason(form.reason, {
            doctor: inputs.doctor.value.trim(),
            nurse: inputs.nurse.value.trim()
        });

        submitButton.disabled = true;
        submitButton.textContent = 'ĐANG GỬI...';
        try {
            const data = await submitMakeupRequest(form);
            if (!data.success) {
                alert.show(`Lỗi: ${data.error}`);
                return;
            }
            alert.show(`✅ ${data.message}`, false);
            inputs.reason.value = '';
            resetPhoto();
            if (form.request_type === MAKEUP_EXISTING) reloadIncomplete();
            else toggleFields();
            reloadHistory();
        } catch (_) {
            alert.show('Lỗi kết nối hệ thống!');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'GỬI YÊU CẦU BÁO BÙ';
        }
    }

    /* ---------- Lịch sử ---------- */

    const history = h('div', null, emptyText('Không có yêu cầu báo bù nào'));

    function historyRow(item) {
        const status = makeupStatusLabel(item);
        return timelineItem({
            stacked: true,
            tone: 'plain',
            children: [
                h('div', { class: 'row-between', style: { marginBottom: '8px' } },
                    h('strong', null, `${item.customer_name} (${requestTypeLabel(item.request_type)})`),
                    badge(status.text, status.tone)
                ),
                h('div', { class: 'history-body' },
                    h('div', null, `Ngày làm: ${formatDate(item.work_date)} | Doanh thu: ${item.revenue}`),
                    h('div', null, `Dịch vụ: ${item.service} (${item.sessions} - ${item.session_type || 'Bán'})`),
                    h('div', { class: 'history-reason' }, h('i', null, `Lý do: ${item.reason}`)),
                    item.reviewed_by
                        ? h('div', { class: 'history-reviewer' }, `Duyệt bởi: ${item.reviewed_by}`)
                        : null
                )
            ]
        });
    }

    async function reloadHistory() {
        replaceChildren(history, loader());
        try {
            const result = await loadMakeupHistory();
            if (!result.success) {
                replaceChildren(history, emptyText('Lỗi tải lịch sử!', 'bad'));
                return;
            }
            const list = result.data || [];
            replaceChildren(history,
                list.length ? list.map(historyRow) : emptyText('Không có yêu cầu báo bù nào'));
        } catch (_) {
            replaceChildren(history, emptyText('Lỗi kết nối mạng!', 'bad'));
        }
    }

    /* ---------- Khung ---------- */

    const node = h('div', null,
        card(
            sectionTitle('Báo Bù Công Tour'),
            alert.node,
            field({ label: 'Loại Yêu Cầu *', input: requestType }),
            groupExisting,
            field({ label: 'Tên Khách Hàng *', input: inputs.customerName }),
            field({ label: 'Số Điện Thoại *', input: inputs.phone }),
            field({ label: 'Dịch Vụ *', input: inputs.service }),
            h('div', { class: 'form-group form-group--inline' },
                h('div', { style: { flex: '1' } }, h('label', null, 'Bác Sĩ'), inputs.doctor),
                h('div', { style: { flex: '1' } }, h('label', null, 'Điều Dưỡng'), inputs.nurse)
            ),
            h('div', { class: 'form-group form-group--inline' },
                h('div', { style: { flex: '1' } }, h('label', null, 'Số Buổi Làm *'), inputs.sessions),
                h('div', { style: { flex: '1' } }, h('label', null, 'Dạng Buổi *'), inputs.sessionType)
            ),
            field({ label: 'Thu Tiền *', input: inputs.revenue }),
            field({ label: 'Giờ Hẹn Khách Hàng *', input: inputs.appointmentTime }),
            field({ label: 'Lý Do Báo Bù (Bắt buộc) *', input: inputs.reason }),
            h('div', { class: 'form-group', style: { marginBottom: '20px' } },
                h('label', null, 'Ảnh Minh Chứng Công Tour *'),
                h('div', { class: 'photo-row' },
                    button({
                        label: '📸 Chọn Ảnh', size: 'sm', variant: 'success',
                        style: { width: 'auto' },
                        onClick: () => photoInput.click()
                    }),
                    photoStatus
                ),
                photoInput,
                photoPreviewBox
            ),
            submitButton
        ),
        card(sectionTitle('Lịch Sử Báo Bù'), history)
    );

    let started = false;
    return {
        node,
        /** Chỉ nạp dữ liệu khi người dùng thực sự mở tab này. */
        onOpen() {
            if (started) return;
            started = true;
            toggleFields();
            reloadIncomplete();
            reloadHistory();
        }
    };
}
