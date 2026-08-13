# Mini App xuất kho

Giao diện xuất kho cho group có `bot_role = 'warehouse'`. Chỉ phục vụ role quản lý
kho; không dùng chung code với check-in, báo cáo KPI hay khách hàng.

## Điểm vào

`/mini-app/warehouse_export.html` → nạp `app.js`. URL giữ nguyên như bản cũ để nút
"Xuất Kho" của bot và hợp đồng tương thích của module kho không phải đổi.

## Cấu trúc

```text
warehouse-export/
├── app.js                  Điều phối: nạp danh mục, chuyển màn hình
├── theme.css               Design token + toàn bộ style
├── core/
│   ├── telegram.js         Bọc Telegram WebApp SDK
│   ├── api.js              fetch + chữ ký xác thực + idempotency key
│   ├── dom.js              h() / replaceChildren() — tạo DOM không dùng innerHTML
│   └── draft.js            Lưu nháp vào localStorage theo group + luồng
├── data/
│   └── warehouse-repo.js   Nguồn dữ liệu duy nhất, gọi API thật
├── ui/
│   ├── icons.js            SVG nội tuyến (vẽ theo Lucide, không cần thư viện)
│   ├── components.js       TopBar, BottomBar, nút, thẻ, stepper, notice…
│   └── scanner.js          Overlay quét mã, bọc window.BarcodeScanner
└── flows/
    ├── entry-screen.js     Chọn loại đơn
    ├── quick-export.js     Xuất lẻ
    └── customer-order.js   Xuất theo khách hàng (5 bước)
```

Hướng phụ thuộc một chiều: `flows` → `ui` / `data` → `core`. Không có chiều ngược lại.

## Hai luồng

| | Xuất theo khách hàng | Xuất lẻ |
|---|---|---|
| API | `POST /api/warehouse/service-orders` | `POST /api/warehouse/export/request` |
| Payload | `services[].items[]` theo mẫu dịch vụ | `items: [{barcode, quantity}]` |
| Điều kiện | Group bật `warehouse_service_order_enabled` **và** Admin đã tạo dịch vụ | Chỉ cần có sản phẩm trong danh mục |
| Màu nhấn | rose `--brand` | cyan `--alt` |

Khi chưa đủ điều kiện, `entry-screen.js` khóa lựa chọn và nói rõ lý do thay vì để
nhân viên nhập xong mới bị server từ chối.

## Nguyên tắc khi sửa

1. **Không hardcode dịch vụ/sản phẩm/tồn kho.** Mọi danh mục đọc từ API trong
   `data/warehouse-repo.js`. Danh mục rỗng thì hiển thị trạng thái rỗng.
2. **Không dùng `innerHTML` cho dữ liệu người dùng.** Dùng `h()` trong `core/dom.js`;
   riêng `icons.js` được phép vì nội dung là hằng số trong file.
3. **Mọi request phải mang đủ chữ ký** `chat_id` + `ts` + `sig` + `action` + `initData`.
   Dùng `apiGet`/`apiPost` trong `core/api.js`, đừng gọi `fetch` trực tiếp.
4. **Không thêm trường UI mà backend chưa lưu.** Ví dụ ghi chú cho đơn xuất lẻ
   hiện chưa có cột trong `tk_warehouse_transactions` nên không đưa vào form.
5. **Giữ đơn vị số lượng là số nguyên ≥ 1.** `tk_products` không có cột đơn vị tính
   nên UI không hiển thị "chai/hộp".

## Test

```powershell
npm run test:warehouse-miniapp
npm run test:warehouse-module
```
