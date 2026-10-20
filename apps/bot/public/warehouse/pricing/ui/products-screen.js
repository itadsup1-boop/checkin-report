/**
 * Logic màn "Giá sản phẩm" — xem nhanh TOÀN BỘ danh mục kèm giá hiện tại,
 * khác với ô tìm kiếm ở màn "Nhập đơn giá" (giới hạn 30 kết quả, dùng để
 * chọn 1 sản phẩm). Tải một lần, lọc tại chỗ trong trình duyệt cho nhanh —
 * không gọi lại API mỗi lần gõ tìm kiếm.
 */
import { loadAllProducts } from '../data/pricing-repo.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
}

function formatDateOnly(value) {
    if (!value) return '';
    const d = new Date(value);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function initProductsScreen() {
    const list = document.getElementById('productsList');
    const empty = document.getElementById('productsEmpty');
    const errorBox = document.getElementById('productsError');
    const errorText = document.getElementById('productsErrorText');
    const refreshBtn = document.getElementById('productsRefreshBtn');
    const searchInput = document.getElementById('productsSearch');
    const countHint = document.getElementById('productsCountHint');

    let allProducts = [];
    let loaded = false;

    function render(products) {
        if (!products.length) {
            list.innerHTML = '';
            empty.classList.add('show');
            return;
        }
        empty.classList.remove('show');
        list.innerHTML = products.map(product => `
            <div class="product-row">
                <div class="product-row-info">
                    <div class="product-row-name">${product.name}</div>
                    <div class="product-row-code">${product.barcode}</div>
                </div>
                <div class="product-row-price">
                    ${product.currentPrice !== null
                        ? `<div class="product-row-value">${formatCurrency(product.currentPrice)}<span class="product-row-unit"> / ${product.priceUnit}</span></div>
                           <div class="product-row-time">Cập nhật ${formatDateOnly(product.priceUpdatedAt)}</div>`
                        : '<div class="product-row-value muted">Chưa có giá</div>'}
                </div>
            </div>
        `).join('');
    }

    function applyFilter() {
        const keyword = searchInput.value.trim().toLowerCase();
        const filtered = keyword
            ? allProducts.filter(p => p.name.toLowerCase().includes(keyword) || p.barcode.toLowerCase().includes(keyword))
            : allProducts;
        countHint.textContent = `${filtered.length}/${allProducts.length} sản phẩm`;
        render(filtered);
    }

    async function loadProducts() {
        errorBox.classList.remove('show');
        list.innerHTML = '<div class="orders-loading">Đang tải danh sách sản phẩm...</div>';
        empty.classList.remove('show');
        try {
            allProducts = await loadAllProducts();
            loaded = true;
            applyFilter();
        } catch (error) {
            list.innerHTML = '';
            errorText.textContent = error.message || 'Không tải được danh sách sản phẩm.';
            errorBox.classList.add('show');
        }
    }

    refreshBtn.addEventListener('click', loadProducts);
    searchInput.addEventListener('input', applyFilter);

    return {
        activate() {
            if (!loaded) loadProducts();
        }
    };
}
