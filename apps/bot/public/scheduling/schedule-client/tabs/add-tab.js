/**
 * Tab 2 — Thêm lịch. Kiêm luôn chế độ CẬP NHẬT khi mở bằng `?action=update&id=`.
 *
 * Ở chế độ cập nhật (chỉ nhóm tour dùng): tên/SĐT/giờ bị khoá vì đổi ba thứ đó là
 * thành một lịch hẹn khác — chỉ cho sửa dịch vụ, doanh thu, phát sinh, bác sĩ,
 * điều dưỡng, và gửi qua PUT /api/schedules/update.
 *
 * Ô "Bác Sĩ / Điều Dưỡng" chỉ hiện với nhóm report_tour.
 */

import { h, replaceChildren } from '../../../shared-ui/core/dom.js';
import { addSchedule, loadScheduleById, updateScheduleDetails } from '../data/schedule-repo.js';
import { validateSessions, SESSION_HELP, toDateTimeLocal } from '../domain/schedule-rules.js';
import { card, field, textInput, selectInput, button, createAlert } from '../ui/components.js';

const SESSION_TYPES = [
    { value: 'Bán', label: 'Bán' },
    { value: 'Bảo hành', label: 'Bảo hành' },
    { value: 'Tặng', label: 'Tặng' }
];

/**
 * @param {object} params
 * @param {boolean} params.isTour hiện ô bác sĩ/điều dưỡng
 * @param {?string} params.updateId khác null là đang ở chế độ cập nhật
 * @param {() => void} params.onAdded gọi sau khi thêm xong, để tab Check tải lại
 */
export function createAddTab({ isTour, updateId, onAdded }) {
    const alert = createAlert();
    const isUpdateMode = Boolean(updateId);

    const inputs = {
        name: textInput({ placeholder: 'Nhập tên khách' }),
        phone: textInput({ type: 'tel', placeholder: 'Nhập SĐT' }),
        service: textInput({ placeholder: 'Tên dịch vụ' }),
        sessions: textInput({ placeholder: 'VD: 2/10 hoặc 1/Tái khám' }),
        sessionType: selectInput({ options: SESSION_TYPES, value: 'Bán' }),
        revenue: textInput({ placeholder: 'VD: 500k' }),
        todayIncurred: textInput({ placeholder: 'Nhập danh sách phát sinh (nếu có)' }),
        doctor: textInput({ placeholder: 'Tên bác sĩ' }),
        nurse: textInput({ placeholder: 'Tên điều dưỡng' }),
        time: textInput({ type: 'datetime-local' })
    };

    const urgent = h('input', { type: 'checkbox', class: 'checkbox-lg' });

    const submitButton = button({
        label: isUpdateMode ? 'Lưu Cập Nhật' : 'ĐĂNG KÝ LỊCH',
        onClick: () => (isUpdateMode ? submitUpdate() : submitAdd())
    });

    /* ---------- Gửi ---------- */

    async function submitUpdate() {
        submitButton.disabled = true;
        submitButton.textContent = 'Đang lưu...';
        try {
            const data = await updateScheduleDetails({
                id: updateId,
                service: inputs.service.value,
                revenue: inputs.revenue.value,
                today_incurred: inputs.todayIncurred.value.trim(),
                doctor: inputs.doctor.value.trim(),
                nurse: inputs.nurse.value.trim()
            });
            if (data.success) {
                alert.show('Cập nhật thành công! Đang tải lại...', false);
                setTimeout(() => { location.search = '?tab=edit'; }, 1500);
                return;
            }
            alert.show(data.error || 'Có lỗi xảy ra');
        } catch (_) {
            alert.show('Lỗi mạng');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'Lưu Cập Nhật';
        }
    }

    async function submitAdd() {
        const name = inputs.name.value;
        const phone = inputs.phone.value;
        const time = inputs.time.value;

        if (!name || !phone || !time) {
            alert.show('Vui lòng điền đủ Tên, SĐT và Giờ hẹn!');
            return;
        }
        const sessions = inputs.sessions.value;
        if (sessions && !validateSessions(sessions)) {
            alert.show(SESSION_HELP);
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = 'Đang đăng ký...';
        try {
            const data = await addSchedule({
                customer_name: name,
                phone,
                service: inputs.service.value,
                sessions,
                session_type: inputs.sessionType.value,
                revenue: inputs.revenue.value,
                today_incurred: inputs.todayIncurred.value.trim(),
                doctor: inputs.doctor.value.trim(),
                nurse: inputs.nurse.value.trim(),
                appointment_time: time,
                is_urgent: urgent.checked
            });
            if (!data.success) {
                alert.show(data.error || 'Có lỗi xảy ra');
                return;
            }
            alert.show('Đã đăng ký lịch thành công!', false);
            for (const input of Object.values(inputs)) input.value = '';
            inputs.sessionType.value = 'Bán';
            urgent.checked = false;
            onAdded(time.split('T')[0]);
        } catch (_) {
            alert.show('Lỗi kết nối máy chủ!');
        } finally {
            submitButton.disabled = false;
            submitButton.textContent = 'ĐĂNG KÝ LỊCH';
        }
    }

    /* ---------- Nạp sẵn khi ở chế độ cập nhật ---------- */

    async function prefillForUpdate() {
        const result = await loadScheduleById(updateId);
        if (!result.success) {
            alert.show(result.error || 'Lỗi tải dữ liệu');
            return;
        }
        const data = result.data;
        inputs.name.value = data.customer_name || '';
        inputs.phone.value = data.phone || '';
        inputs.service.value = data.service || '';
        inputs.sessions.value = data.sessions || '';
        inputs.sessionType.value = data.session_type || 'Bán';
        inputs.revenue.value = data.revenue || '';
        inputs.todayIncurred.value = data.today_incurred || '';
        inputs.doctor.value = data.doctor || '';
        inputs.nurse.value = data.nurse || '';
        if (data.appointment_time) inputs.time.value = toDateTimeLocal(data.appointment_time);

        inputs.name.disabled = true;
        inputs.phone.disabled = true;
        inputs.time.disabled = true;
    }

    if (isUpdateMode) prefillForUpdate();

    /* ---------- Khung ---------- */

    const doctorNurseGroup = h('div', {
        class: 'form-group form-group--inline',
        style: { display: isTour ? 'flex' : 'none' }
    },
        h('div', { style: { flex: '1' } }, h('label', null, 'Bác Sĩ'), inputs.doctor),
        h('div', { style: { flex: '1' } }, h('label', null, 'Điều Dưỡng'), inputs.nurse)
    );

    const node = card(
        alert.node,
        field({ label: 'Tên Khách Hàng *', input: inputs.name }),
        field({ label: 'Số Điện Thoại *', input: inputs.phone }),
        field({ label: 'Dịch Vụ', input: inputs.service }),
        h('div', { class: 'form-group form-group--inline' },
            h('div', { style: { flex: '1' } }, h('label', null, 'Số Buổi Làm'), inputs.sessions),
            h('div', { style: { flex: '1' } }, h('label', null, 'Dạng Buổi *'), inputs.sessionType)
        ),
        field({ label: 'Thu Tiền', input: inputs.revenue }),
        field({ label: 'Danh sách phát sinh hôm nay', input: inputs.todayIncurred }),
        doctorNurseGroup,
        field({ label: 'Ngày Giờ Hẹn (Cách nhau >= 1 tiếng) *', input: inputs.time }),
        // Chế độ cập nhật không có khái niệm "khách đi luôn".
        isUpdateMode ? null : h('div', { class: 'urgent-row' },
            urgent,
            h('label', { class: 'urgent-label' }, '🚨 Khách đi luôn')
        ),
        submitButton
    );

    return { node };
}
