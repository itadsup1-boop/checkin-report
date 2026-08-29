# Mini App xem tồn kho

Màn hình **tra cứu** tồn kho cho group có `bot_role = 'warehouse'`. Chỉ đọc, không có
thao tác ghi nào — nhập kho và xuất kho là hai Mini App riêng.

## Điểm vào

`/mini-app/warehouse_inventory.html` → nạp `app.js`. URL giữ nguyên như bản cũ để nút
"Xem Tồn Kho" của bot, `router.html` và lệnh `/start whinventory_...` không phải đổi.

## Cấu trúc

```text
warehouse-inventory/
├── app.js                    Điều phối: xác thực, nạp dữ liệu, gắn màn hình
├── theme.css                 Design token + toàn bộ style
├── data/
│   └── inventory-repo.js     Gọi API thật + các hàm tính toán thuần (stockOf, stockStatus, summarize)
├── ui/
│   └── components.js         Tab cơ sở, thẻ thống kê, dải cảnh báo, ô tìm, dòng sản phẩm
└── screens/
    ├── inventory-overview.js Màn hình chính: giữ state lọc/tìm/cảnh báo
    └── product-detail.js     Sheet chi tiết: tồn theo cơ sở + lịch sử biến động
```

Hạ tầng dùng chung (`core/*`, `ui/icons.js`) nằm ở
[`../../shared-ui/`](../../shared-ui/README.md).

Hướng phụ thuộc một chiều: `screens` → `ui` / `data` → `shared-ui/core`. Chỉ
`screens/` được giữ state; `ui/` và `data/` không.

## Dữ liệu

| Hiển thị | Nguồn thật |
|---|---|
| Danh mục + tồn theo từng cơ sở | `GET /api/warehouse/stock-overview` (`tk_products` + `tk_inventory`) |
| Lịch sử nhập/xuất/điều chuyển | `GET /api/warehouse/product-history` (`tk_warehouse_ledger` + `employees`) |
| Số dư trước/sau mỗi biến động | `balance_before` / `balance_after` trong ledger |
| Người thực hiện | `employees.full_name` join theo `actor_employee_id` |

Dùng `stock-overview` chứ **không** dùng `/api/warehouse/inventory`: endpoint kia
`LEFT JOIN tk_inventory` mà không gộp theo sản phẩm nên trả một dòng cho mỗi cơ sở,
làm sản phẩm có hàng ở cả US và UK bị hiện hai lần.

## Những gì cố tình KHÔNG có

Bản mockup ban đầu có đơn vị tính ("chai", "miếng") và ngưỡng tồn tối thiểu riêng cho
từng sản phẩm. `tk_products` chỉ có `id`, `barcode`, `product_name`, `is_active`,
`created_at` — **không có** hai cột đó, nên UI không hiển thị chúng thay vì bịa số.

Ngưỡng "sắp hết" hiện là hằng số dùng chung `NGUONG_SAP_HET` trong
`data/inventory-repo.js` (quy tắc hiển thị, không phải dữ liệu). Muốn ngưỡng riêng theo
sản phẩm thì cần thêm cột vào `tk_products` + giao diện cấu hình ở Web Admin trước.

## Ba cách thu hẹp danh sách (kết hợp được với nhau)

1. **Tab cơ sở** — Tất cả / US / UK. Ở tab "Tất cả", mỗi dòng hiện thêm `US x / UK y`.
2. **Tìm kiếm** — theo tên hoặc mã vạch, lọc tại máy vì danh mục chỉ vài chục mặt hàng.
3. **Lọc "cần chú ý"** — hết hàng (0) hoặc sắp hết (≤ ngưỡng), bấm vào thẻ đỏ hoặc dải
   cảnh báo.

Tình trạng luôn tính theo **cơ sở đang chọn**, không theo tổng: đang xem tab US thì
"hết hàng" nghĩa là hết ở US.

## Nguyên tắc khi sửa

1. **Không hardcode sản phẩm/tồn kho.** Danh mục rỗng thì hiện trạng thái rỗng.
2. **Không dùng `innerHTML`.** Dùng `h()` trong `../../shared-ui/core/dom.js`.
3. **Mọi request qua `apiGet`** để luôn mang đủ chữ ký; đừng gọi `fetch` trực tiếp.
4. **Khi gõ tìm kiếm chỉ vẽ lại danh sách** (`renderList()`), không vẽ lại cả màn hình —
   vẽ lại ô input sẽ làm mất con trỏ đang gõ trên điện thoại.
5. **Không thêm nút ghi dữ liệu vào đây.** Đây là màn hình tra cứu; thêm thao tác ghi
   sẽ phá quyền hạn đang được phân theo từng chức năng.

## Test

```powershell
npm run test:warehouse-miniapp
npm run check:warehouse
```
