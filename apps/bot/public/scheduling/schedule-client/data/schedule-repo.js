/**
 * Nguồn dữ liệu của Mini App lịch khách.
 *
 * Xác thực ở đây KHÁC Mini App kho: các endpoint lịch khách nhận `groupId` +
 * `telegram_id` trên query và `initData` qua header `x-telegram-init-data`,
 * KHÔNG dùng chữ ký ts/sig. Giữ nguyên để không phải đổi 10 route ở server.
 */

import { getInitData, getLaunchParams } from '../../../shared-ui/core/telegram.js';

/**
 * Group id lấy từ `?chat_id=` hoặc phần tử thứ hai của payload
 * `scheduleclient_<groupId>_<ts>_<sig>` (cũng dùng cho `schedule_`/`makeupclient_`).
 */
export function getGroupId() {
    const params = new URLSearchParams(location.search);
    const direct = params.get('chat_id');
    if (direct) return direct;
    return getLaunchParams({ defaultAction: 'scheduleclient' }).chatId || '';
}

export function getTelegramUserId() {
    return globalThis.Telegram?.WebApp?.initDataUnsafe?.user?.id || '';
}

function authHeaders(extra = {}) {
    const headers = { ...extra };
    const initData = getInitData();
    if (initData) headers['x-telegram-init-data'] = initData;
    return headers;
}

async function request(path, options = {}) {
    let response;
    try {
        response = await fetch(path, options);
    } catch (_) {
        throw new Error('Lỗi kết nối máy chủ!');
    }
    const data = await response.json().catch(() => ({}));
    return data;
}

const jsonPost = (path, body, method = 'POST') => request(path, {
    method,
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
});

const query = params => new URLSearchParams(params).toString();

/* ---------- Vai trò nhóm ---------- */

/**
 * Nhóm `report_tour` mới thấy tab Báo Bù Công Tour và ô Bác sĩ / Điều dưỡng.
 * Lỗi mạng thì coi như KHÔNG phải tour — thà ẩn tính năng còn hơn mở nhầm.
 */
export async function loadGroupRole() {
    const groupId = getGroupId();
    if (!groupId) return null;
    const data = await request(`/api/groups/role?${query({ groupId })}`, { headers: authHeaders() });
    return data.success ? data.role : null;
}

/* ---------- Tab Check lịch ---------- */

export async function loadSchedules(date) {
    const data = await request(`/api/schedules?${query({
        date, groupId: getGroupId(), telegram_id: getTelegramUserId()
    })}`);
    return data.data || [];
}

export async function searchByPhone(phone) {
    const data = await request(`/api/schedules/search?${query({
        phone, groupId: getGroupId(), telegram_id: getTelegramUserId()
    })}`);
    return data.data || [];
}

/* ---------- Tab Thêm / Sửa / Hủy ---------- */

export function addSchedule(form) {
    return jsonPost('/api/schedules/add', {
        ...form,
        initData: getInitData(),
        groupId: getGroupId()
    });
}

export function editSchedule({ id, customer_name, appointment_time, phone }) {
    // service/sessions gửi rỗng: màn hình sửa chỉ đổi tên và giờ, server giữ nguyên phần còn lại.
    return jsonPost('/api/schedules/edit', {
        id, customer_name, appointment_time, phone,
        service: '', sessions: '',
        groupId: getGroupId()
    });
}

export function cancelSchedule({ id, cancel_reason }) {
    return jsonPost('/api/schedules/cancel', { id, cancel_reason, groupId: getGroupId() });
}

/* ---------- Chế độ cập nhật dịch vụ (chỉ nhóm tour) ---------- */

export async function loadScheduleById(id) {
    return request(`/api/schedules/${encodeURIComponent(id)}`, { headers: authHeaders() });
}

export function updateScheduleDetails(form) {
    return jsonPost('/api/schedules/update', form, 'PUT');
}

/* ---------- Tab Nhiệm vụ (nợ ảnh) ---------- */

export async function loadPhotoDebts(date) {
    const data = await request(`/api/photo-debts?${query({
        date, groupId: getGroupId()
    })}`, { headers: authHeaders() });
    return data.data || [];
}

export function uploadProof({ id, imageBase64 }) {
    return jsonPost('/api/upload-proof', { id, imageBase64, groupId: getGroupId() });
}

/* ---------- Tab Báo bù công tour ---------- */

export async function loadIncompleteSchedules() {
    return request(`/api/schedules/incomplete?${query({ groupId: getGroupId() })}`, {
        headers: authHeaders()
    });
}

export function submitMakeupRequest(payload) {
    return jsonPost('/api/schedules/makeup', { ...payload, groupId: getGroupId() });
}

export async function loadMakeupHistory() {
    return request('/api/schedules/makeup/history', { headers: authHeaders() });
}

/* ---------- Chức năng Báo Tour, Sửa Tour, Check Tour (role report_tour) ---------- */

export async function loadTodaySuggestions() {
    const data = await request(`/api/schedules/tour/suggestions?${query({
        groupId: getGroupId()
    })}`, { headers: authHeaders() });
    return data.data || [];
}

export async function loadDoctors() {
    const data = await request(`/api/schedules/tour/doctors?${query({
        groupId: getGroupId()
    })}`, { headers: authHeaders() });
    return data.data || [];
}

export async function loadKtvs() {
    const res = await request(`/api/schedules/tour/ktvs?${query({
        groupId: getGroupId(),
        telegram_id: getTelegramUserId()
    })}`, { headers: authHeaders() });
    const list = res.data || [];
    list.userLastKtv = res.userLastKtv || '';
    list.userEmpName = res.userEmpName || '';
    return list;
}

export async function loadTourStats(date) {
    const user = globalThis.Telegram?.WebApp?.initDataUnsafe?.user;
    const ktvName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';
    const data = await request(`/api/schedules/tour/stats?${query({
        groupId: getGroupId(),
        date: date || '',
        telegram_id: getTelegramUserId(),
        ktv_name: ktvName
    })}`, { headers: authHeaders() });
    return data.data || { todayCredit: 0, monthCredit: 0, totalCredit: 0, totalCount: 0, tours: [] };
}

export async function loadRecentTours() {
    const user = globalThis.Telegram?.WebApp?.initDataUnsafe?.user;
    const ktvName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';
    const storedKtv = (typeof localStorage !== 'undefined' && localStorage.getItem('last_tour_ktv1')) || '';
    const data = await request(`/api/schedules/tour/recent?${query({
        groupId: getGroupId(),
        telegram_id: getTelegramUserId(),
        ktv_name: ktvName || storedKtv
    })}`, { headers: authHeaders() });
    return data.data || [];
}

export function submitTourReport(form) {
    const user = globalThis.Telegram?.WebApp?.initDataUnsafe?.user;
    const sender = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'KTV';
    return jsonPost('/api/schedules/tour/submit', {
        ...form,
        groupId: getGroupId(),
        telegramUserId: getTelegramUserId(),
        reportedBy: sender
    });
}

export function updateTourReport(id, form) {
    const user = globalThis.Telegram?.WebApp?.initDataUnsafe?.user;
    const ktvName = user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '';
    const storedKtv = (typeof localStorage !== 'undefined' && localStorage.getItem('last_tour_ktv1')) || '';
    return jsonPost(`/api/schedules/tour/${encodeURIComponent(id)}`, {
        ...form,
        groupId: getGroupId(),
        telegramUserId: getTelegramUserId(),
        updaterKtv: ktvName || storedKtv
    }, 'PUT');
}
