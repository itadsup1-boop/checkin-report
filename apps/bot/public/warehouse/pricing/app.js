/**
 * Điều phối Mini App "Nhập đơn giá sản phẩm".
 *
 * Nhiệm vụ duy nhất: khởi tạo Telegram, xác thực quyền MANAGE_PRICING/Admin
 * thật từ server, rồi giao cho pricing-screen.js xử lý phần còn lại. Markup
 * đã có sẵn trong shell HTML (giữ nguyên template đã thiết kế).
 */
import { initTelegram, isInsideTelegram } from '../../shared-ui/core/telegram.js';
import { configureWarehouseApi } from '../../shared-ui/core/api.js';
import { loadAccess } from './data/pricing-repo.js';
import { initPricingScreen } from './ui/pricing-screen.js';
import { initProductsScreen } from './ui/products-screen.js';
import { initOrdersScreen } from './ui/orders-screen.js';

configureWarehouseApi({ action: 'whpricing' });

function showPermissionBlocker() {
    document.getElementById('permissionBlocker').classList.add('show');
}

/** Chuyển 3 tab dưới cùng: "Nhập đơn giá" / "Giá sản phẩm" / "Tổng tiền các đơn". */
function initTabs(access, products, orders) {
    const navPricing = document.getElementById('navPricing');
    const navProducts = document.getElementById('navProducts');
    const navOrders = document.getElementById('navOrders');
    const screenPricing = document.getElementById('screenPricing');
    const screenProducts = document.getElementById('screenProducts');
    const screenOrders = document.getElementById('screenOrders');
    const footer = document.getElementById('pricingFooter');

    if (!access.canManage) {
        navPricing.classList.add('disabled');
    }

    function activate(tab) {
        navPricing.classList.toggle('active', tab === 'pricing');
        navProducts.classList.toggle('active', tab === 'products');
        navOrders.classList.toggle('active', tab === 'orders');
        screenPricing.classList.toggle('show', tab === 'pricing');
        screenProducts.classList.toggle('show', tab === 'products');
        screenOrders.classList.toggle('show', tab === 'orders');
        footer.classList.toggle('show', tab === 'pricing');
        if (tab === 'products') products.activate();
        if (tab === 'orders') orders.activate();
    }

    navPricing.addEventListener('click', () => {
        if (!access.canManage) return;
        activate('pricing');
    });
    navProducts.addEventListener('click', () => activate('products'));
    navOrders.addEventListener('click', () => activate('orders'));

    activate(access.canManage ? 'pricing' : 'products');
}

async function start() {
    if (!isInsideTelegram()) {
        showPermissionBlocker();
        return;
    }

    let access;
    try {
        access = await loadAccess();
    } catch (error) {
        showPermissionBlocker();
        return;
    }

    if (!access.canManage && !access.canView) {
        showPermissionBlocker();
        return;
    }

    if (access.canManage) initPricingScreen(access);
    const products = initProductsScreen();
    const orders = initOrdersScreen();
    initTabs(access, products, orders);
}

initTelegram();
start();
