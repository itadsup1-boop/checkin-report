# Warehouse module

Module này chứa phần backend đang chạy của chức năng quản lý kho trong Telegram Bot.

## Trạng thái

- Đã tách API kho, callback Telegram, upload ảnh và đồng bộ Google Sheet khỏi `timekeep_bot.js`.
- Giữ nguyên endpoint, callback data, bảng database và URL Mini App cũ.
- Đã triển khai đơn theo khách hàng/dịch vụ, quyền theo group, điều chuyển, ledger và outbox.
- Luồng cũ vẫn tồn tại sau feature flag nhưng đã dùng quyền Web Admin và transaction khóa tồn.
- Domain/application/repository mới nằm tại `packages/warehouse`.

## Cấu trúc

```text
warehouse/
├── index.js
├── README.md
├── warehouse.module.test.js
├── warehouse-import.integration.test.js
├── warehouse-miniapp.test.js
├── service-order-sheet-sync.test.js
├── http/
│   ├── register-warehouse-routes.js
│   ├── catalog-routes.js
│   ├── import-routes.js
│   ├── export-routes.js
│   ├── service-order-routes.js
│   └── warehouse-image-upload.js
├── integrations/
│   ├── google-sheets.js
│   ├── service-order-sheet-sync.js
│   └── outbox-worker.js
└── telegram/
    ├── register-warehouse-handlers.js
    ├── register-single-order-actions.js
    ├── register-group-order-actions.js
    ├── register-service-order-actions.js
    └── register-proof-handler.js
```

## Public entry point

Module khác chỉ được import:

```js
import { registerWarehouseModule } from './src/modules/warehouse/index.js';
```

Không import trực tiếp file trong `http/`, `telegram/` hoặc `integrations/` từ role khác.

## Hợp đồng tương thích đang được giữ

### HTTP

- `GET /api/products/by-barcode/:barcode`
- `GET /api/warehouse/products`
- `GET /api/warehouse/inventory`
- `GET /api/warehouse/check-stock`
- `POST /api/warehouse/import`
- `POST /api/warehouse/export/request`
- `GET /api/warehouse/service-order/bootstrap`
- `GET /api/warehouse/customers/suggestion`
- `POST /api/warehouse/service-orders`
- `GET /api/warehouse/service-orders/:orderId`
- `POST /api/warehouse/service-orders/:orderId/approve`
- `POST /api/warehouse/service-orders/:orderId/reject`

### Telegram

- `wh_approve_*`
- `wh_reject_*`
- `wh_appgrp_*`
- `wh_rejgrp_*`
- `wh_svc_approve_*`
- `wh_svc_reject_*`
- Reply ảnh vào tin nhắn `[YÊU CẦU XUẤT KHO ĐÃ DUYỆT]`.

### Upload nhập kho

- Chỉ nhận ảnh.
- Tối đa 6 ảnh.
- Tối đa 15 MB cho mỗi ảnh tại server.
- Tên form field: `media_files`.

## Quy tắc phụ thuộc

1. `timekeep_bot.js` chỉ khởi tạo và truyền dependency vào module.
2. Route/callback của kho phải nằm trong module này.
3. Module kho không được đăng ký cron KPI, check-in hoặc customer handler.
4. Database là nguồn dữ liệu chính; Sheet và Drive là integration chạy sau.
5. Mọi API kho phải giữ middleware xác thực Mini App.
6. Thay đổi endpoint hoặc callback cũ phải có lớp tương thích và test.
7. Không cấp quyền duyệt dựa trên role người dùng tự chọn trong thiết kế mới.

## Lệnh kiểm tra

```powershell
npm run test:warehouse-module
npm run test:warehouse-all
npm run dev:web
```

Khi thêm route hoặc callback mới, cập nhật `warehouse.module.test.js` trước khi đưa lên production.

## Domain dùng chung

```text
packages/warehouse/
├── domain/
│   ├── constants.js
│   └── order-validation.js
├── application/
│   └── warehouse-order-service.js
└── infrastructure/
    └── postgres/warehouse-query-repository.js
```
