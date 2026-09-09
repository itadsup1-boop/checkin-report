# Mô tả chức năng: Xem tồn kho

Tài liệu mô tả chức năng "Xem Tồn Kho" của role quản lý kho, đúng theo code đang chạy.

- Mini App: `apps/bot/public/warehouse_inventory.html`
- API: `GET /api/warehouse/stock-overview` (`apps/bot/src/modules/warehouse/http/catalog-routes.js`)
- Cập nhật: 12/08/2026

## 1. Mục đích

Cho nhân sự trong nhóm kho tra nhanh **số lượng tồn thực tế** của toàn bộ danh mục
sản phẩm, tách theo từng cơ sở, ngay trong Telegram mà không cần mở Web Admin.

Đây là chức năng **chỉ đọc**. Không nhập, không xuất, không sửa tồn kho từ màn hình này.

## 2. Cách mở

Trong nhóm Telegram có `bot_role = 'warehouse'`, bấm nút **📊 Xem Tồn Kho** ở
menu chức năng kho. Có ba đường vào và cả ba đều phải hoạt động:

| Đường vào | URL Mini App nhận được |
|---|---|
| Nút trong nhóm (deep link `?startapp=`) | Telegram đưa chữ ký vào `initDataUnsafe.start_param` |
| `router.html` chuyển hướng | `warehouse_inventory.html?payload=whinventory_<gid>_<ts>_<sig>` |
| Lệnh `/start whinventory_...` | `warehouse_inventory.html?chat_id=&ts=&sig=&action=whinventory` |

Chuỗi gộp có thứ tự `[action, chat_id, ts, sig]`. Hàm `resolveWarehouseAuth()` xử lý
cả bốn dạng (kể cả `?tgWebAppStartParam=`) và phải được gọi **sau** `tg.ready()`
mới đọc được `start_param`.

## 3. Quyền truy cập

Mọi request đều qua middleware `authenticateTelegramMiniApp` (bắt buộc có `initData`
của Telegram) rồi qua `authorizeActor`. Điều kiện được xem:

1. Nhóm phải có `bot_role = 'warehouse'`, đang `is_active` và chưa `is_deleted`.
2. Người mở phải thuộc một trong các trường hợp:
   - Nằm trong `ADMIN_IDS` (admin hệ thống), **hoặc**
   - Là nhân sự `is_active` **và** là thành viên `ACTIVE` của nhóm đó
     (`employee_group_memberships`), **hoặc**
   - Là nhân sự `is_active` **và** có ít nhất một quyền kho trong nhóm đó
     (`tk_warehouse_permissions`).

Không đủ điều kiện thì API trả `403`. Thiếu chữ ký hoặc `initData` thì trả `400`/`401`
và màn hình hiện thông báo lỗi thay vì danh sách trắng.

Chức danh nhân viên tự chọn **không** cấp quyền — quyền do Admin gán theo từng nhóm.

## 4. Màn hình

```text
┌─────────────────────────────────────┐
│  TỒN KHO THỰC TẾ                    │
│  Xem danh sách số lượng tồn hiện tại│
├─────────────────────────────────────┤
│  [ Tìm tên sản phẩm hoặc mã vạch ]  │
├─────────────────────────────────────┤
│  Mũ con sâu                    195  │
│  ⚡ 001                    Đủ hàng  │
│  🏢 US: 80 · UK: 115                │
│  🕒 Cập nhật: 14:32 12/08           │
├─────────────────────────────────────┤
│  Chỉ Dafilon 5                   1  │
│  ⚡ 0123                  Sắp hết   │
│  🏢 US: 0 · UK: 1                   │
├─────────────────────────────────────┤
│        ❌ ĐÓNG ỨNG DỤNG             │
└─────────────────────────────────────┘
```

Mỗi dòng sản phẩm gồm:

| Thành phần | Nguồn dữ liệu |
|---|---|
| Tên sản phẩm | `tk_products.product_name` |
| Mã vạch | `tk_products.barcode` |
| Tồn từng cơ sở | `tk_inventory.quantity` lọc theo `branch` = `US` / `UK` |
| Tổng tồn | `stock_us + stock_uk` (tính ở client) |
| Trạng thái | Suy ra từ tổng tồn, xem mục 6 |
| Thời gian cập nhật | `MAX(tk_inventory.updated_at)` của sản phẩm đó |

## 5. Nguồn dữ liệu

Gọi `GET /api/warehouse/stock-overview` một lần khi mở màn hình.

```sql
SELECT p.id AS product_id, p.barcode, p.product_name,
       COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'US'), 0)::int AS stock_us,
       COALESCE(MAX(i.quantity) FILTER (WHERE i.branch = 'UK'), 0)::int AS stock_uk,
       MAX(i.updated_at) AS updated_at
FROM tk_products p
LEFT JOIN tk_inventory i ON i.product_id = p.id
WHERE p.is_active = TRUE
GROUP BY p.id, p.barcode, p.product_name
ORDER BY p.product_name
```

Đặc điểm quan trọng:

- **Đúng một dòng cho mỗi sản phẩm.** Gộp theo `p.id` và tách tồn bằng `FILTER`.
- Sản phẩm đã tạm ẩn (`is_active = FALSE`) không hiển thị.
- Sản phẩm chưa có bản ghi tồn ở một cơ sở thì cơ sở đó hiện `0`, không hiện trống.
- PostgreSQL là nguồn duy nhất. Google Sheet chỉ là bản đối chiếu ghi sau, màn hình
  này **không** đọc từ Sheet.

Không dùng `GET /api/warehouse/inventory` (endpoint cũ) vì nó `LEFT JOIN tk_inventory`
mà không lọc `branch`, nên trả một dòng cho **mỗi cơ sở**: sản phẩm có hàng ở cả US và
UK bị hiện hai lần và không có cột nào cho biết dòng đó thuộc cơ sở nào. Endpoint cũ
vẫn được giữ để không phá tương thích với phần khác.

## 6. Quy tắc phân loại trạng thái

Dựa trên **tổng tồn hai cơ sở**:

| Tổng tồn | Nhãn | Màu |
|---|---|---|
| `= 0` | Hết hàng | đỏ |
| `1 – 10` | Sắp hết | vàng/cam |
| `> 10` | Đủ hàng | xanh |

Ngưỡng `10` là hằng số trong `renderInventory()`, chưa cấu hình được theo nhóm hay
theo sản phẩm.

## 7. Tìm kiếm

Ô tìm kiếm lọc **ngay trên dữ liệu đã tải** (không gọi lại server), khớp không phân
biệt chữ hoa/thường với:

- tên sản phẩm, **hoặc**
- mã vạch

Xoá ô tìm kiếm thì hiện lại toàn bộ danh sách.

## 8. Các trạng thái màn hình

| Trạng thái | Nội dung hiển thị |
|---|---|
| Đang tải | Vòng xoay + "Đang tải dữ liệu tồn kho..." |
| Danh mục trống | "📭 Chưa có sản phẩm nào trong kho!" |
| Tìm không ra | Danh sách rỗng |
| API trả lỗi | "Lỗi: " + thông báo do server trả về |
| Mất mạng | "Lỗi kết nối máy chủ!" |

Nút **ĐÓNG ỨNG DỤNG** gọi `tg.close()` để quay về khung chat.

## 9. Giới hạn hiện tại

Những điều màn hình này **không** làm, cần biết để tránh kỳ vọng sai:

1. **Không có đơn vị tính.** Bảng `tk_products` không có cột đơn vị, nên chỉ hiện số.
2. **Không tự cập nhật.** Dữ liệu chụp tại thời điểm mở; muốn số mới phải mở lại.
3. **Không phân trang.** Tải toàn bộ danh mục một lần. Hiện ~14 sản phẩm nên chưa
   thành vấn đề; nếu danh mục lên hàng nghìn thì cần bổ sung phân trang.
4. **Không lọc theo cơ sở.** Luôn hiện cả US và UK trên cùng một dòng.
5. **Không xem được lịch sử biến động.** Sổ ledger nằm ở Web Admin.
6. **Ngưỡng "Sắp hết" cố định 10**, không theo từng sản phẩm.
7. Tồn kho là **toàn hệ thống**, không tách theo nhóm Telegram — mọi nhóm kho có
   quyền đều thấy cùng một con số.

## 10. Lịch sử lỗi đã sửa (12/08/2026)

| Lỗi | Nguyên nhân | Hậu quả |
|---|---|---|
| Không tải được dữ liệu | Chỉ đọc `?chat_id=&ts=&sig=` rời, không đọc `?payload=` / `start_param` | Mở từ nút trong nhóm luôn bị API trả `400`; chỉ vào được bằng `/start whinventory_` |
| Sản phẩm hiện hai lần | Endpoint cũ `LEFT JOIN tk_inventory` không lọc `branch` | "Mũ con sâu" hiện 2 dòng (`80` và `115`) không rõ cơ sở, thay vì 1 dòng `US 80 · UK 115 = 195` |

## 11. Kiểm thử

```powershell
npm run test:warehouse-miniapp
```

Các test liên quan:

- `Mini App tồn kho vẫn gửi chữ ký kèm chat_id khi đọc danh mục`
- `Mini App tồn kho đọc được chữ ký từ cả ba đường vào`
- `Mini App tồn kho dùng stock-overview để không hiện trùng dòng`
- `module kho đăng ký đủ endpoint cũ...` (trong `test:warehouse-module`) — chốt danh
  sách route, gồm cả `GET /api/warehouse/stock-overview`

## 12. Khi sửa chức năng này

1. Giữ nguyên việc mọi request mang đủ `chat_id` + `ts` + `sig` + `action` + `initData`.
2. Không thêm cột dữ liệu mà database chưa có (ví dụ đơn vị tính) — sẽ thành số liệu bịa.
3. Nếu đổi endpoint, cập nhật danh sách route trong `warehouse.module.test.js`.
4. Không đưa Google Sheet thành nguồn đọc tồn kho.
