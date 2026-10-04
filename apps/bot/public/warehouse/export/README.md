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
├── data/
│   └── warehouse-repo.js   Nguồn dữ liệu duy nhất, gọi API thật
├── ui/
│   └── components.js       TopBar, BottomBar, nút, thẻ, stepper, notice…
└── flows/
    ├── entry-screen.js     Chọn loại đơn
    ├── quick-export.js     Xuất lẻ
    └── order/              Xuất theo khách hàng — 5 bước, đủ lớn nên thành thư mục
        ├── index.js        Điều phối: state, gọi API, nối các bước
        ├── order-draft.js  Quy tắc thuần: payload, tính đủ/thiếu, điều kiện đi tiếp
        └── steps/
            ├── customer-step.js
            ├── service-step.js
            ├── product-step.js
            └── confirm-step.js
```

`order/` là một **luồng bên trong app xuất kho**, không phải Mini App thứ tư: nó dùng
chung vỏ `warehouse_export.html`, chung danh mục đã nạp và chung màn hình chọn loại đơn
với luồng xuất lẻ. Tách ra thư mục ngang hàng với `export/` sẽ buộc app này phải import
xuyên qua app khác.

Hạ tầng dùng chung (`core/telegram.js`, `core/api.js`, `core/dom.js`, `core/draft.js`,
`core/branches.js`, `ui/icons.js`, `ui/scanner.js`) nằm ở
[`../../shared-ui/`](../../shared-ui/README.md) vì Mini App nhập kho và tồn kho dùng
lại đúng những file đó — xem README ở đó trước khi sửa.

Hướng phụ thuộc một chiều: `flows` → `ui` / `data` → `shared-ui/core`. Không có
chiều ngược lại.

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
2. **Không dùng `innerHTML` cho dữ liệu người dùng.** Dùng `h()` trong
   `../../shared-ui/core/dom.js`; riêng `icons.js` được phép vì nội dung là hằng số
   trong file.
3. **Mọi request phải mang đủ chữ ký** `chat_id` + `ts` + `sig` + `action` + `initData`.
   Dùng `apiGet`/`apiPost` trong `../../shared-ui/core/api.js`, đừng gọi `fetch` trực tiếp.
4. **Không thêm trường UI mà backend chưa lưu.** Ví dụ ghi chú cho đơn xuất lẻ
   hiện chưa có cột trong `tk_warehouse_transactions` nên không đưa vào form.
5. **Giữ đơn vị số lượng là số nguyên ≥ 1.** `tk_products` không có cột đơn vị tính
   nên UI không hiển thị "chai/hộp".

## Test

```powershell
npm run test:warehouse-miniapp
npm run test:warehouse-module
```
