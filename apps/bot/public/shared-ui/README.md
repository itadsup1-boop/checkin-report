# Hạ tầng dùng chung của mọi Mini App

Không phải một Mini App. Đây là phần **không mang nghiệp vụ** mà mọi Mini App đều cần.

Hiện có ba app dùng:
[`warehouse/import/`](../warehouse/import/README.md),
[`warehouse/export/`](../warehouse/export/README.md),
[`warehouse/inventory/`](../warehouse/inventory/README.md).

Đặt ở gốc `public/` chứ không nằm trong `warehouse/` là cố ý: các Mini App chấm công và
lịch khách khi tách ra cũng sẽ dùng chính bộ này.

Tách ra vì trước đây các file này nằm chung trong Mini App xuất kho; mỗi app mới mà copy
sang là hàng trăm dòng trùng lặp — sửa xác thực một bên rất dễ quên bên kia.

## Cấu trúc

```text
shared-ui/
├── core/
│   ├── telegram.js   Bọc Telegram WebApp SDK; getLaunchParams() đọc chữ ký từ MỌI đường vào
│   ├── api.js        apiGet/apiPost + chữ ký xác thực + idempotency key
│   ├── dom.js        h() / replaceChildren() / cx() — tạo DOM không dùng innerHTML
│   ├── draft.js      Lưu nháp vào localStorage theo group + luồng
│   └── branches.js   Danh sách cơ sở — code phải khớp cột tk_inventory.branch
└── ui/
    ├── icons.js      SVG nội tuyến (vẽ theo Lucide, không cần tải thư viện)
    └── scanner.js    Overlay quét mã, bọc window.BarcodeScanner
```

`scanner.js` cần `theme.css` của app định nghĩa `.scanner`, `.scanner__stage`,
`.scanner__close`.

## Nguyên tắc

1. **Chỉ chứa thứ dùng chung.** Có thành phần chỉ một app dùng thì để trong app đó.
2. **Không phụ thuộc ngược lên app.** `core/` và `ui/` không được import bất cứ gì từ
   `warehouse/import/`, `warehouse/export/` hay `warehouse/inventory/`.
3. **`getLaunchParams()` phải giữ đủ 4 đường vào** (`start_param`, `?payload=`,
   `?startapp=`, `?chat_id=&ts=&sig=`). Bỏ bớt một dạng là một cách mở Mini App bị lỗi
   xác thực — đã xảy ra một lần với đường `?payload=` từ `router.html`.
4. **Mỗi app gọi `configureWarehouseApi({ action })` một lần** trong `app.js`
   (`whimport` / `whexport` / `whinventory`), để query string và FormData không mang
   hai action khác nhau.
5. **Danh sách cơ sở chỉ khai ở `core/branches.js`.** `code` là giá trị thật trong
   database, đổi ở đây mà không đổi database là hỏng nhập/xuất kho. Có test chặn việc
   khai lại `BRANCHES` ở nơi khác.
6. **Sửa file ở đây là sửa cả ba app.** Chạy `npm run test:warehouse-miniapp` để test
   kiểm tra chéo cả ba.
7. **Token cache của bot đã tính thư mục này** (`warehouseAssetDirs` trong
   `timekeep_bot.js`); thêm thư mục module mới thì phải khai báo ở đó.
