/**
 * Logic màn "Tổng tiền các đơn" — danh sách đơn xuất đã duyệt kèm tổng tiền,
 * người xuất, cơ sở. Markup nằm sẵn trong shell HTML, file này chỉ gắn hành
 * vi thật vào đúng id, giữ đúng tầng ui/ như các Mini App kho khác.
 */
import { loadOrderTotals } from '../data/pricing-repo.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
}

function formatDateTime(value) {
    if (!value) return '—';
    const d = new Date(value);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initOrdersScreen() {
    const list = document.getElementById('ordersList');
    const empty = document.getElementById('ordersEmpty');
    const errorBox = document.getElementById('ordersError');
    const errorText = document.getElementById('ordersErrorText');
    const refreshBtn = document.getElementById('ordersRefreshBtn');

    let loaded = false;

    function renderOrders(orders) {
        if (!orders.length) {
            list.innerHTML = '';
            empty.classList.add('show');
            return;
        }
        empty.classList.remove('show');
        list.innerHTML = orders.map(order => `
            <div class="order-card">
                <div class="order-card-top">
                    <span class="order-code">${order.orderCode}</span>
                    <span class="order-total">${formatCurrency(order.totalAmount)}</span>
                </div>
                <div class="order-card-meta">
                    <span>${order.createdByName}</span>
                    <span>${order.branch || '—'}</span>
                </div>
                <div class="order-card-bottom">
                    <span class="order-time">${formatDateTime(order.approvedAt)}</span>
                    ${order.hasMissingPrice
                        ? '<span class="order-badge warn">Còn thiếu giá</span>'
                        : '<span class="order-badge ok">Đủ giá</span>'}
                </div>
            </div>
        `).join('');
    }

    async function loadOrders() {
        errorBox.classList.remove('show');
        list.innerHTML = '<div class="orders-loading">Đang tải danh sách đơn...</div>';
        empty.classList.remove('show');
        try {
            const orders = await loadOrderTotals();
            renderOrders(orders);
            loaded = true;
        } catch (error) {
            list.innerHTML = '';
            errorText.textContent = error.message || 'Không tải được danh sách đơn.';
            errorBox.classList.add('show');
        }
    }

    refreshBtn.addEventListener('click', loadOrders);

    return {
        activate() {
            if (!loaded) loadOrders();
        }
    };
}
