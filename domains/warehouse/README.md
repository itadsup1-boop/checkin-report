# Domain: Quản lý kho

Toàn bộ nghiệp vụ kho nằm trong thư mục này. Đây là **domain chuẩn đầu tiên** của dự
án — các nghiệp vụ sau (chấm công, báo cáo KPI, khách hàng) sẽ theo đúng khung này.

## Cấu trúc

```text
domains/warehouse/
├── index.js                    Cổng vào công khai DUY NHẤT
│
├── domain/                     Thuần nghiệp vụ — CẤM import express/pg/telegraf
│   ├── constants.js            Cơ sở, trạng thái đơn, mã quyền, WarehouseError
│   └── order-validation.js     Quy tắc hợp lệ của đơn, gộp dòng hàng
│
├── application/                Use case — điều phối domain + repository
│   └── warehouse-order-service.js
│
├── infrastructure/             Nói chuyện với thế giới bên ngoài
│   ├── postgres/               Truy vấn database
│   ├── google-sheet/           Đồng bộ Sheet (nhập/xuất, đơn dịch vụ, tồn kho)
│   └── outbox/                 Tiến trình nền, retry khi tích hợp lỗi
│
├── interfaces/                 Các cửa vào
│   ├── telegram/               Callback duyệt đơn, reply ảnh xác nhận
│   └── miniapp-api/            HTTP cho Mini App (danh mục, nhập, xuất, đơn dịch vụ)
│
└── tests/
```

## Hướng phụ thuộc

```text
interfaces/  ──►  application/  ──►  domain/
     │                 │
     └─────────────────┴──────►  infrastructure/
```

Chiều ngược lại bị cấm. `tests/architecture.test.js` kiểm tra tự động, vi phạm là
test đỏ ngay — quy tắc không nằm ở tài liệu mà nằm ở máy.

## Cách dùng từ bên ngoài

Chỉ được import qua `index.js`, tuyệt đối không với tay vào file bên trong:

```js
import { registerWarehouseModule } from '../../domains/warehouse/index.js';
```

`index.js` cũng xuất lại các nguyên thủy của domain (`WarehouseError`,
`WAREHOUSE_PERMISSIONS`, `createWarehouseOrderService`…) cho app và domain khác dùng.

Hiện `apps/bot/timekeep_bot.js` lắp phần Telegram + Mini App. Phần Web Admin còn nằm
ở `apps/api/src/modules/warehouse-admin/` và sẽ được đưa vào `interfaces/admin-api/`
ở giai đoạn 2.

## Hợp đồng tương thích đang được giữ

### HTTP (Mini App)

- `GET /api/products/by-barcode/:barcode`
- `GET /api/warehouse/products`
- `GET /api/warehouse/inventory`
- `GET /api/warehouse/next-barcode`
- `GET /api/warehouse/stock-overview`
- `GET /api/warehouse/check-stock`
- `POST /api/warehouse/import`
- `POST /api/warehouse/export/request`
- `GET /api/warehouse/config`
- `GET /api/warehouse/service-order/bootstrap`
- `GET /api/warehouse/customers/suggestion`
- `POST /api/warehouse/service-orders`
- `GET /api/warehouse/service-orders/:orderId`
- `POST /api/warehouse/service-orders/:orderId/approve`
- `POST /api/warehouse/service-orders/:orderId/reject`

### Telegram

`wh_approve_*`, `wh_reject_*`, `wh_appgrp_*`, `wh_rejgrp_*`, `wh_svc_approve_*`,
`wh_svc_reject_*`, và reply ảnh vào tin nhắn `[YÊU CẦU XUẤT KHO ĐÃ DUYỆT]`.

### Upload nhập kho

Chỉ ảnh, tối đa 6 ảnh, mỗi ảnh tối đa 15 MB, tên field `media_files`.

## Quy tắc khi sửa

1. Database là nguồn sự thật. Google Sheet và Drive là tích hợp chạy sau, không bao
   giờ là nguồn đọc tồn kho.
2. Không cấp quyền duyệt dựa trên chức danh nhân viên tự chọn — quyền do Admin gán
   theo từng nhóm trong `tk_warehouse_permissions`.
3. Đổi endpoint hoặc callback cũ phải có lớp tương thích và cập nhật
   `tests/warehouse.module.test.js` (test chốt danh sách route chính xác).
4. Mã vạch là duy nhất cho mỗi sản phẩm. Không được ghi đè tên sản phẩm khi trùng mã.
5. Không đặt SQL kho ra ngoài `infrastructure/postgres/`.

## Chạy test

```powershell
npm run check:warehouse            # kiến trúc + domain + module + admin + UI
npm run test:warehouse-architecture # riêng ràng buộc kiến trúc
npm run test:warehouse-miniapp
npm run test:warehouse-sheet
```

Các lệnh có đuôi `-db` chạy trên **database thật**, không nên chạy trên máy
production.

## Migration

Nằm tập trung ở `packages/database/migrations/` cùng các nghiệp vụ khác, vì cả hệ
thống dùng chung một PostgreSQL và thứ tự chạy phải thống nhất.
