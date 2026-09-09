# Domain hồ sơ khách hàng

Ghi nhận một lượt khách: thông tin khách, thanh toán, ảnh/video minh chứng.
Áp dụng cho group có `bot_role = 'customer'` hoặc `'customer_record'`.

Đây là domain thứ ba được tách ra khỏi `apps/bot/timekeep_bot.js`, sau
[`warehouse`](../warehouse/README.md) và [`scheduling`](../scheduling/README.md).

## Cổng vào

```js
import { registerCustomerModule } from '../../domains/customer/index.js';
```

`index.js` là **lối vào duy nhất**. Đừng import thẳng vào `application/`,
`infrastructure/` hay `interfaces/` — ruột đổi lúc nào cũng được, cổng thì không.

## Cấu trúc

```text
domains/customer/
├── index.js                                    Lắp ghép toàn bộ domain
├── domain/
│   └── record-rules.js                         Quy tắc thuần: role, hạn mức, mã CR:, đuôi file
├── application/
│   ├── create-customer-record.js               Ghi hồ sơ (2 nửa: đồng bộ + nền)
│   ├── accept-telegram-media.js                Kiểm quyền rồi xếp hàng ảnh reply
│   ├── collect-telegram-media.js               Worker tải hàng đợi lên Drive
│   └── summarize-daily-customers.js            Tổng kết 22:00
├── infrastructure/
│   ├── postgres/customer-repository.js         Toàn bộ SQL
│   ├── drive/customer-drive.js                 Thư mục + tải file
│   ├── google-sheet/customer-sheet.js          Đồng bộ Sheet
│   └── telegram/customer-notifier.js           Mọi lời gọi Telegram
├── interfaces/
│   ├── miniapp-api/customer-routes.js          POST /api/customer/save
│   ├── telegram/register-media-reply.js        bot.on(photo/video/document)
│   └── cron/register-daily-summary.js          Lịch 22:00
└── tests/
    ├── customer.module.test.js                 Hợp đồng + luật kiến trúc
    └── customer-miniapp.test.js                Mini App phía trình duyệt
```

Giao diện Mini App nằm ở [`apps/bot/public/customer/form/`](../../apps/bot/public/customer/form/README.md).

Hướng phụ thuộc một chiều: `interfaces` → `application` → `domain`, còn
`infrastructure` chỉ được `index.js` lắp vào. `domain/` không import gì ngoài chính nó.

## Hợp đồng tương thích — đổi là gãy

| Thứ | Giá trị | Ai đang phụ thuộc |
|---|---|---|
| Đường dẫn | `POST /api/customer/save` | Mini App đang chạy production |
| Field tệp | `media_files`, tối đa 20 | `data/customer-repo.js` |
| Mã hồ sơ | `CR:<uuid>` trong tin đích | Mọi tin nhắn CŨ còn trong nhóm |
| Bảng | `public.customer_records`, `public.customer_record_telegram_media` | Web Admin, báo cáo |
| Sheet | `THÔNG TIN KHÁCH HÀNG THỰC TẾ`, 16 cột | Quản lý đang đọc file này |

Mã `CR:` là ràng buộc nặng nhất: nhân viên vẫn có thể reply vào một tin nhắn đăng
từ tháng trước. Đổi định dạng mã là những tin đó chết.

## Hai đường ảnh vào Drive

| Chế độ | Đường đi | Vì sao có |
|---|---|---|
| `mini_app` | Mini App gửi kèm tệp → route tải thẳng lên Drive ở nửa nền | Nhanh, một lần xong |
| `telegram_reply` | Bot đăng tin đích → nhân viên reply ảnh → xếp hàng DB → worker tải | Tệp nặng, mạng yếu; Telegram tải khoẻ hơn Mini App |

Hai đường này **gặp nhau ở một điểm**: `initializationJobs` trong `index.js`. Ảnh
reply có thể về trước khi hồ sơ kịp tạo xong thư mục Drive, nên worker phải chờ
đúng job khởi tạo của hồ sơ đó rồi mới tải — nếu không sẽ có hai thư mục cho cùng
một khách. Đây là lý do Map đó phải dùng chung một thể hiện, đừng tách ra.

## Nguyên tắc khi sửa

1. **Trả lời Mini App trước, làm việc nặng sau.** Drive và Sheet chậm; giữ chân
   nhân viên trong form là họ bấm gửi lại → hồ sơ trùng.
2. **Chỉ người tạo hồ sơ được gửi bổ sung ảnh.** Ảnh khách hàng là dữ liệu nhạy cảm.
3. **Không phải việc của mình thì `next()`.** Handler ảnh đứng chung hàng với role
   báo cáo và chấm công; nuốt mất là hỏng ảnh minh chứng của họ.
4. **Hỏng thì lùi lịch, đừng bỏ file** (1 → 5 → 15 → 30 phút). Nhân viên đã gửi ảnh
   thì không được bắt gửi lại.
5. **Postgres là nguồn sự thật.** Sheet và Drive là bản sao xuôi dòng.

## Test

```powershell
npm run test:customer-module     # hợp đồng + luật kiến trúc, không cần DB
npm run test:customer-miniapp    # phía trình duyệt
npm run check:customer           # node --check + cả hai bộ trên
```
