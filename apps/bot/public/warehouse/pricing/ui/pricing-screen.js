/**
 * Logic tương tác của màn "Nhập đơn giá sản phẩm" — markup tĩnh nằm sẵn trong
 * shell HTML (warehouse_pricing.html), file này chỉ gắn hành vi thật vào đúng
 * các phần tử theo id, giữ nguyên cấu trúc/giao diện đã thiết kế.
 *
 * Cho phép sửa giá NHIỀU sản phẩm rồi mới gửi chung một lần: mỗi lần "Thêm
 * vào danh sách chờ gửi" chỉ đẩy sản phẩm + giá mới vào một giỏ tạm (Map,
 * khóa theo product id — sửa lại một sản phẩm đã có trong giỏ sẽ ghi đè, không
 * bị lặp dòng); bấm "Gửi tất cả" mới thật sự gọi API lưu, qua save-batch.
 */
import { searchProducts, loadPriceHistory, saveProductPricesBatch } from '../data/pricing-repo.js';
import { closeApp } from '../../../shared-ui/core/telegram.js';

function formatCurrency(value) {
    return new Intl.NumberFormat('vi-VN').format(value) + ' đ';
}

function parsePrice(value) {
    return Number(String(value).replace(/\D/g, '')) || 0;
}

function formatDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateOnly(value) {
    if (!value) return '';
    const d = new Date(value);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatTimeOnly(value) {
    if (!value) return '';
    const d = new Date(value);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function initPricingScreen(access) {
    let selectedProduct = null;
    let selectedHistory = [];
    let historyVisible = false;
    let isSubmitting = false;
    let searchToken = 0;
    let searchDebounceTimer = null;
    const cart = new Map(); // productId -> { product, newPrice }

    const productSearch = document.getElementById('productSearch');
    const clearSearch = document.getElementById('clearSearch');
    const searchResults = document.getElementById('searchResults');
    const selectedBox = document.getElementById('selectedBox');
    const selectedName = document.getElementById('selectedName');
    const selectedCode = document.getElementById('selectedCode');
    const currentPrice = document.getElementById('currentPrice');
    const currentPriceTime = document.getElementById('currentPriceTime');
    const newPriceInput = document.getElementById('newPrice');
    const difference = document.getElementById('difference');
    const priceUnitHint = document.getElementById('priceUnitHint');
    const priceUnitLabel = document.getElementById('priceUnitLabel');
    const currencySuffix = document.getElementById('currencySuffix');
    const addToCartBtn = document.getElementById('addToCartBtn');
    const cartCard = document.getElementById('cartCard');
    const cartHint = document.getElementById('cartHint');
    const cartList = document.getElementById('cartList');
    const clearCartBtn = document.getElementById('clearCartBtn');
    const submitBtn = document.getElementById('submitBtn');
    const errorBox = document.getElementById('errorBox');
    const errorText = document.getElementById('errorText');
    const historyContent = document.getElementById('historyContent');
    const historyToggle = document.getElementById('historyToggle');
    const confirmOverlay = document.getElementById('confirmOverlay');
    const confirmDesc = document.getElementById('confirmDesc');
    const confirmSummary = document.getElementById('confirmSummary');
    const processing = document.getElementById('processing');
    const processingText = document.getElementById('processingText');
    const processingFill = document.getElementById('processingFill');
    const successScreen = document.getElementById('successScreen');
    const resultCard = document.getElementById('resultCard');
    const patchedResult = document.getElementById('patchedResult');
    const toast = document.getElementById('toast');

    document.getElementById('userName').textContent = access.fullName;
    document.getElementById('userRole').textContent = access.role;
    document.querySelector('.avatar').textContent = (access.fullName || '?').slice(0, 1).toUpperCase();

    function showError(message) {
        errorText.textContent = message;
        errorBox.classList.add('show');
        errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function hideError() {
        errorBox.classList.remove('show');
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 1800);
    }

    function setStepState(step) {
        const stepOne = document.getElementById('stepOne');
        const stepTwo = document.getElementById('stepTwo');
        const stepThree = document.getElementById('stepThree');

        [stepOne, stepTwo, stepThree].forEach(element => element.classList.remove('active', 'done'));
        stepOne.querySelector('.step-number').textContent = '1';
        stepTwo.querySelector('.step-number').textContent = '2';

        if (step === 1) stepOne.classList.add('active');

        if (step === 2) {
            stepOne.classList.add('done');
            stepOne.querySelector('.step-number').textContent = '✓';
            stepTwo.classList.add('active');
        }

        if (step === 3) {
            stepOne.classList.add('done');
            stepTwo.classList.add('done');
            stepOne.querySelector('.step-number').textContent = '✓';
            stepTwo.querySelector('.step-number').textContent = '✓';
            document.getElementById('stepThree').classList.add('active');
        }
    }

    /* ---------- Giỏ chờ gửi ---------- */

    function renderCart() {
        const items = Array.from(cart.values());
        cartCard.style.display = items.length ? 'block' : 'none';
        cartHint.textContent = `${items.length} sản phẩm`;
        submitBtn.textContent = `Gửi tất cả (${items.length})`;
        submitBtn.disabled = isSubmitting || items.length === 0;

        cartList.innerHTML = items.map(({ product, newPrice }) => `
            <div class="cart-item">
                <span class="cart-item-icon">📦</span>
                <div class="cart-item-info">
                    <div class="cart-item-name">${product.name}</div>
                    <div class="cart-item-price">
                        ${product.currentPrice !== null ? formatCurrency(product.currentPrice) : 'Chưa có giá'}
                        → <span class="new">${formatCurrency(newPrice)}</span> / ${product.priceUnit}
                    </div>
                </div>
                <button class="cart-item-remove" data-id="${product.id}" aria-label="Xóa">×</button>
            </div>
        `).join('');

        cartList.querySelectorAll('.cart-item-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                cart.delete(btn.dataset.id);
                renderCart();
            });
        });
    }

    /* ---------- Tìm & chọn sản phẩm ---------- */

    async function renderSearch(query) {
        const token = ++searchToken;
        let matches;
        try {
            matches = await searchProducts(query);
        } catch (error) {
            showError(error.message || 'Không thể tìm sản phẩm.');
            return;
        }
        if (token !== searchToken) return; // có tìm kiếm mới hơn đã gõ tiếp, bỏ kết quả cũ

        if (!matches.length) {
            searchResults.innerHTML = '<div class="empty-result">Không tìm thấy sản phẩm phù hợp.</div>';
            searchResults.classList.add('show');
            return;
        }

        searchResults.innerHTML = matches.map(product => `
            <button class="product-option" data-id="${product.id}">
                <span class="product-icon">📦</span>
                <span class="product-info">
                    <span class="product-name">${product.name}</span>
                    <span class="product-code">${product.barcode}</span>
                </span>
                <span class="product-price">${product.currentPrice !== null ? formatCurrency(product.currentPrice) : 'Chưa có giá'}</span>
            </button>
        `).join('');

        searchResults.classList.add('show');
        searchResults.querySelectorAll('.product-option').forEach(option => {
            const product = matches.find(p => String(p.id) === option.dataset.id);
            option.addEventListener('click', () => selectProduct(product));
        });
    }

    async function selectProduct(product) {
        selectedProduct = product;

        // Nếu sản phẩm này đã có trong giỏ chờ gửi, mở lại đúng giá đang chờ để sửa tiếp.
        const pending = cart.get(product.id);

        productSearch.value = product.name;
        clearSearch.classList.add('show');
        searchResults.classList.remove('show');

        selectedName.textContent = product.name;
        selectedCode.textContent = product.barcode;
        selectedBox.classList.add('show');

        currentPrice.textContent = product.currentPrice !== null ? formatCurrency(product.currentPrice) : 'Chưa có giá';
        currentPriceTime.textContent = product.priceUpdatedAt ? 'Cập nhật ' + formatDateOnly(product.priceUpdatedAt) + ' ' + formatTimeOnly(product.priceUpdatedAt) : 'Chưa từng nhập giá';

        // Nhân viên chỉ biết giá theo đơn vị đóng gói (vd Lọ) — hiện rõ đơn vị
        // này ở mọi chỗ liên quan đến giá để không cần tự quy đổi trong đầu.
        priceUnitHint.textContent = `Giá theo ${product.priceUnit}`;
        priceUnitLabel.textContent = `(theo ${product.priceUnit})`;
        currencySuffix.textContent = `đ/${product.priceUnit}`;

        newPriceInput.disabled = false;
        newPriceInput.value = pending ? new Intl.NumberFormat('vi-VN').format(pending.newPrice) : '';
        updateDifference();

        historyVisible = false;
        selectedHistory = [];
        historyContent.innerHTML = '<div class="history-empty">Đang tải lịch sử...</div>';
        historyToggle.textContent = 'Xem lịch sử';

        setStepState(2);
        validateForm();
        hideError();

        try {
            selectedHistory = await loadPriceHistory(product.id);
        } catch (error) {
            historyContent.innerHTML = `<div class="history-empty">${error.message || 'Không tải được lịch sử giá.'}</div>`;
            return;
        }
        renderHistory();

        setTimeout(() => newPriceInput.focus(), 120);
    }

    function resetProduct() {
        selectedProduct = null;
        selectedHistory = [];
        productSearch.value = '';
        clearSearch.classList.remove('show');
        selectedBox.classList.remove('show');
        searchResults.classList.remove('show');

        currentPrice.textContent = '—';
        currentPriceTime.textContent = 'Chưa chọn sản phẩm';
        newPriceInput.value = '';
        newPriceInput.disabled = true;
        difference.textContent = '';
        priceUnitHint.textContent = 'Đơn vị VNĐ';
        priceUnitLabel.textContent = '';
        currencySuffix.textContent = 'đ';

        historyVisible = false;
        historyToggle.textContent = 'Xem lịch sử';
        historyContent.classList.remove('show');
        historyContent.innerHTML = '<div class="history-empty">Chọn sản phẩm để xem lịch sử giá.</div>';

        setStepState(1);
        validateForm();
        productSearch.focus();
    }

    function renderHistory() {
        if (!selectedProduct) return;

        if (!selectedHistory.length) {
            historyContent.innerHTML = '<div class="history-empty">Sản phẩm này chưa từng được nhập giá.</div>';
        } else {
            historyContent.innerHTML = selectedHistory.map((item, index) => `
                <div class="history-item">
                    <span class="history-dot"></span>
                    <div>
                        <div class="history-price">
                            ${formatCurrency(item.price)}
                            ${index === 0 ? '<span class="current-badge">Hiện tại</span>' : ''}
                        </div>
                        <div class="history-user">Nhập bởi ${item.user}</div>
                    </div>
                    <div class="history-time">${formatDateOnly(item.createdAt)}<br>${formatTimeOnly(item.createdAt)}</div>
                </div>
            `).join('');
        }

        historyContent.classList.toggle('show', historyVisible);
        historyToggle.textContent = historyVisible ? 'Thu gọn' : 'Xem lịch sử';
    }

    function updateDifference() {
        if (!selectedProduct) return;

        const newPrice = parsePrice(newPriceInput.value);
        const oldPrice = selectedProduct.currentPrice;

        difference.className = 'difference';

        if (!newPrice || oldPrice === null) {
            difference.textContent = '';
            return;
        }

        const change = newPrice - oldPrice;
        const percentage = oldPrice ? Math.abs((change / oldPrice) * 100).toFixed(1) : '0.0';

        if (change > 0) {
            difference.textContent = 'Tăng ' + formatCurrency(change) + ' · ' + percentage + '%';
            difference.classList.add('up');
        } else if (change < 0) {
            difference.textContent = 'Giảm ' + formatCurrency(Math.abs(change)) + ' · ' + percentage + '%';
            difference.classList.add('down');
        } else {
            difference.textContent = 'Giá mới đang trùng với giá hiện tại';
            difference.classList.add('same');
        }
    }

    function validateForm() {
        const newPrice = parsePrice(newPriceInput.value);
        const oldPrice = selectedProduct ? selectedProduct.currentPrice : null;

        addToCartBtn.disabled = isSubmitting || !selectedProduct || newPrice <= 0 || newPrice === oldPrice;

        if (selectedProduct && newPrice > 0 && newPrice !== oldPrice) {
            setStepState(3);
        } else if (selectedProduct) {
            setStepState(2);
        }
    }

    productSearch.addEventListener('focus', () => {
        if (!selectedProduct) renderSearch(productSearch.value);
    });

    productSearch.addEventListener('input', event => {
        const value = event.target.value;
        clearSearch.classList.toggle('show', value.length > 0);

        if (selectedProduct && value !== selectedProduct.name) {
            selectedProduct = null;
            selectedBox.classList.remove('show');
            currentPrice.textContent = '—';
            currentPriceTime.textContent = 'Chưa chọn sản phẩm';
            newPriceInput.value = '';
            newPriceInput.disabled = true;
            difference.textContent = '';
            priceUnitHint.textContent = 'Đơn vị VNĐ';
            priceUnitLabel.textContent = '';
            currencySuffix.textContent = 'đ';
            setStepState(1);
            validateForm();
        }

        // Gõ nhanh nhiều ký tự thì mỗi ký tự đều kèm kiểm tra thành viên nhóm qua
        // Telegram (getChatMember) — gõ dồn dập rất dễ bị Telegram trả 429 Too Many
        // Requests. Debounce lại để chỉ gọi API sau khi ngừng gõ 350ms.
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => renderSearch(value), 350);
    });

    clearSearch.addEventListener('click', resetProduct);
    document.getElementById('changeProductBtn').addEventListener('click', resetProduct);

    newPriceInput.addEventListener('input', event => {
        const value = parsePrice(event.target.value);
        event.target.value = value ? new Intl.NumberFormat('vi-VN').format(value) : '';
        updateDifference();
        validateForm();
        hideError();
    });

    historyToggle.addEventListener('click', () => {
        if (!selectedProduct) {
            showError('Vui lòng chọn sản phẩm trước khi xem lịch sử giá.');
            return;
        }
        historyVisible = !historyVisible;
        renderHistory();
    });

    /* ---------- Thêm vào giỏ chờ gửi ---------- */

    addToCartBtn.addEventListener('click', () => {
        if (!selectedProduct) return showError('Vui lòng chọn sản phẩm.');

        const newPrice = parsePrice(newPriceInput.value);
        if (newPrice <= 0) return showError('Vui lòng nhập đơn giá hợp lệ.');
        if (newPrice === selectedProduct.currentPrice) return showError('Giá mới phải khác giá hiện tại.');

        cart.set(selectedProduct.id, { product: selectedProduct, newPrice });
        renderCart();
        hideError();
        showToast(`Đã thêm "${selectedProduct.name}" vào danh sách chờ gửi`);
        resetProduct();
    });

    clearCartBtn.addEventListener('click', () => {
        if (!cart.size) return;
        cart.clear();
        renderCart();
    });

    /* ---------- Gửi tất cả ---------- */

    submitBtn.addEventListener('click', () => {
        const items = Array.from(cart.values());
        if (!items.length) return;

        confirmDesc.textContent = `Giá hiện tại không bị xóa. Hệ thống sẽ lưu giá mới cho ${items.length} sản phẩm và ghi nhận người thực hiện.`;
        confirmSummary.innerHTML = items.map(({ product, newPrice }) => `
            <div class="summary-row">
                <span class="summary-label">${product.name}</span>
                <span class="summary-value" style="color:var(--brand)">${formatCurrency(newPrice)} / ${product.priceUnit}</span>
            </div>
        `).join('');

        confirmOverlay.classList.add('show');
    });

    document.getElementById('cancelConfirmBtn').addEventListener('click', () => {
        confirmOverlay.classList.remove('show');
    });

    confirmOverlay.addEventListener('click', event => {
        if (event.target === confirmOverlay) confirmOverlay.classList.remove('show');
    });

    document.getElementById('confirmSaveBtn').addEventListener('click', async () => {
        const items = Array.from(cart.values());
        if (!items.length || isSubmitting) return;

        isSubmitting = true;
        renderCart();
        confirmOverlay.classList.remove('show');
        processing.classList.add('show');

        processingFill.style.width = '25%';
        processingText.textContent = `Đang lưu ${items.length} đơn giá và bảo toàn lịch sử giá cũ...`;
        const stepTimer1 = setTimeout(() => {
            processingFill.style.width = '60%';
            processingText.textContent = 'Đang kiểm tra và vá các đơn xuất còn thiếu giá...';
        }, 700);
        const stepTimer2 = setTimeout(() => {
            processingFill.style.width = '85%';
            processingText.textContent = 'Đang đồng bộ dữ liệu lên Google Sheet...';
        }, 1500);

        let results;
        try {
            results = await saveProductPricesBatch(
                items.map(({ product, newPrice }) => ({ productId: product.id, newPrice }))
            );
        } catch (error) {
            clearTimeout(stepTimer1);
            clearTimeout(stepTimer2);
            processing.classList.remove('show');
            isSubmitting = false;
            renderCart();
            showError(error.message || 'Lỗi khi lưu danh sách đơn giá.');
            return;
        }

        clearTimeout(stepTimer1);
        clearTimeout(stepTimer2);
        processingFill.style.width = '100%';
        processingText.textContent = 'Đã hoàn tất.';

        const succeeded = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        const totalPatched = succeeded.reduce((sum, r) => sum + (r.patchedOrderCount || 0), 0);

        document.getElementById('successTitle').textContent = failed.length
            ? `Đã lưu ${succeeded.length}/${results.length} đơn giá`
            : `Đã lưu ${succeeded.length} đơn giá thành công!`;
        document.getElementById('successIcon').textContent = failed.length ? '⚠️' : '✓';
        document.getElementById('successDesc').textContent = failed.length
            ? 'Một số sản phẩm chưa lưu được, vui lòng kiểm tra lại bên dưới và thử lại.'
            : 'Giá mới đã có hiệu lực. Giá cũ được giữ lại để bạn có thể tra cứu bất cứ lúc nào.';

        resultCard.innerHTML = results.map(r => {
            const item = items.find(i => i.product.id === r.productId);
            const name = item ? item.product.name : r.productId;
            if (r.success) {
                return `
                    <div class="result-row">
                        <span class="result-label">${name}</span>
                        <span class="result-value" style="color:var(--brand)">${formatCurrency(r.newPrice)} / ${r.priceUnit}</span>
                    </div>
                `;
            }
            return `
                <div class="result-row">
                    <span class="result-label">${name}</span>
                    <span class="result-value" style="color:var(--danger)">✗ ${r.message || 'Lỗi'}</span>
                </div>
            `;
        }).join('');

        patchedResult.textContent = totalPatched > 0
            ? `✓ Đã vá giá cho ${totalPatched} đơn xuất cũ`
            : '✓ Không có đơn xuất cũ nào bị thiếu giá';

        cart.clear();
        renderCart();

        setTimeout(() => {
            processing.classList.remove('show');
            successScreen.classList.add('show');
            isSubmitting = false;
        }, 300);
    });

    document.getElementById('finishBtn').addEventListener('click', () => {
        successScreen.classList.remove('show');
        showToast('Đã hoàn tất gửi danh sách đơn giá');
    });

    document.getElementById('closeBtn').addEventListener('click', () => closeApp());
    document.getElementById('closePermissionBtn').addEventListener('click', () => closeApp());

    document.addEventListener('click', event => {
        if (!event.target.closest('.search-wrap') && !event.target.closest('.search-results')) {
            searchResults.classList.remove('show');
        }
    });

    setStepState(1);
    renderCart();
}
