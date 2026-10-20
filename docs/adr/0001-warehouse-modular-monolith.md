# ADR-0001: Tách warehouse theo modular monolith

- Trạng thái: Accepted
- Ngày quyết định: 2026-08-12
- Phạm vi: Telegram Bot, Mini App kho và Web Admin kho

## Bối cảnh

Trước khi tách, API, SQL, upload, Google Sheet, Google Drive và callback Telegram của kho cùng nằm trong `apps/bot/timekeep_bot.js`. File này đồng thời xử lý chấm công, khách hàng và các role khác nên thay đổi kho có phạm vi ảnh hưởng lớn.

Hệ thống hiện chỉ có một PostgreSQL và các luồng kho cần transaction nhất quán. Tách microservice ngay sẽ tạo thêm bài toán triển khai, giao tiếp mạng và transaction phân tán.

## Quyết định

Sử dụng modular monolith:

1. Giữ nguyên các process `kpi-api` và `timekeep-bot`.
2. Kho là module nghiệp vụ độc lập bên trong bot.
3. `registerWarehouseModule()` là public entry point duy nhất.
4. Dependency database, bot, xác thực, Drive và Sheet được truyền từ composition root.
5. Route HTTP, handler Telegram và integration được tách theo adapter.
6. Tiếp tục tách domain/application/repository theo từng use case, không big-bang rewrite.
7. Giữ nguyên endpoint, callback và URL Mini App trong giai đoạn chuyển đổi.

## Ranh giới khái niệm

- `warehouse`: module được bật cho một group Telegram.
- Warehouse permission: quyền của một người trong đúng group đó.
- Chức danh hoặc role do nhân viên tự chọn không phải nguồn cấp quyền duyệt.

## Hướng phụ thuộc

```text
Express/Telegram
       |
       v
Application use case
       |
       v
Domain rule
       |
       v
Repository port
       |
       v
PostgreSQL / Drive / Sheet / Telegram
```

Domain không được import Express, Telegraf, PostgreSQL hoặc Google API.

## Hệ quả tích cực

- Sửa kho ít ảnh hưởng role khác.
- Có thể test đăng ký route/callback mà không khởi động bot hoặc database.
- Có đường nâng cấp dần cho timekeep, report và customer.
- Sau này có thể tách warehouse thành service riêng nếu tải vận hành thực sự yêu cầu.

## Đánh đổi

- Trong thời gian chuyển đổi sẽ tồn tại code mới theo module và một số composition glue trong file cũ.
- SQL cũ chưa thể chuyển hết sang repository trong một commit an toàn.
- Phải duy trì contract test để tránh mất endpoint/callback khi di chuyển.

## Các điều bị cấm

- Không import file nội bộ warehouse từ role khác.
- Không đặt thêm SQL kho vào `timekeep_bot.js`.
- Không để Google Sheet trở thành nguồn tồn kho chính.
- Không thay framework frontend cùng lúc với việc chuyển transaction kho.
- Không xóa endpoint/callback cũ khi chưa có giai đoạn tương thích.
