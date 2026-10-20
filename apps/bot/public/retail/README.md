# Mini App: Check-in Điểm Bán Thị Trường (Retail Check-in)

Màn hình Telegram Mini App cho nhân viên thị trường check-in tại các điểm bán, quầy kệ, bách hóa, siêu thị theo tuyến được phân công.

## 1. Điểm Vào (Entry Point)

- **File HTML Shell**: `/mini-app/retail_checkin.html`
- **Mục đích**: Nhận tham số URL từ Telegram Bot (`chat_id`, `telegram_id`, `ts`, `sig`, `tab`), nạp bộ token giao diện dùng chung, nạp stylesheet riêng của module và nạp file script điều phối (`app.js`).
- URL này được giữ nguyên cố định để các nút bấm trên bot, `router.html` và lệnh `/start` của Telegram hoạt động ổn định và nhất quán.

---

## 2. Cấu Trúc Thư Mục

```text
apps/bot/public/retail/
├── README.md               Tài liệu kiến trúc & hướng dẫn phát triển mở rộng
├── theme.css               Toàn bộ Design System & Stylesheet (KPI card, GPS, Grid, Modals)
├── gps-service.js          Dịch vụ định vị GPS (Telegram LocationManager + HTML5 Fallback)
└── app.js                  Điều phối giao diện, nạp dữ liệu, kiểm tra ảnh, gửi check-in & xem lịch sử
```

---

## 3. Các Thành Phần Chính & Luồng Dữ Liệu

### A. Giao diện (theme.css)
- **Topbar & Avatar**: Hiển thị tên nhân viên, chức danh và đồng hồ thời gian thực dạng `HH:mm:ss - DD/MM/YYYY`.
- **Thẻ KPI Tiến Độ**: Thanh tiến độ màu xanh dương chuyển sắc, tính tỷ lệ số điểm đã check-in / mục tiêu (mặc định 15 điểm).
- **Thẻ Định Vị GPS (`.gps-card`)**: Hiển thị toạ độ thực tế, trạng thái kết nối vệ tinh và nút mở Google Maps.
- **Khối Chụp Ảnh (`.photo-grid`, `.shelf-grid`)**: Hỗ trợ 1 ảnh selfie có mặt trước biển hiệu và nhiều ảnh chụp quầy kệ bên trong điểm bán.
- **Thanh Điều Hướng Lịch Sử**: Cho phép xem lại lịch sử check-in theo từng ngày cụ thể (lùi/tiến ngày, chọn ngày bằng date picker hoặc bấm "Hôm nay").

### B. Dịch vụ Định vị GPS (`gps-service.js`)
- Tự động phát hiện phiên bản Telegram WebApp: Nếu hỗ trợ `LocationManager` (Bot API 8.0+) thì kích hoạt qua bot client.
- Nếu không, tự động chuyển đổi sang chuẩn `navigator.geolocation.getCurrentPosition` của trình duyệt.
- Xử lý timeout (12s), sai số (accuracy) và tự động tạo đường dẫn Google Maps dạng `https://maps.google.com/?q=lat,lng`.

### C. Logic Điều phối (`app.js`)
- **Khởi tạo (`bootstrap`)**: Gọi `GET /api/retail-checkin/bootstrap?telegram_id=...&chat_id=...` để nạp thông tin nhân viên, tiến độ trong ngày và kiểm tra ca làm việc (08:30 - 18:00, Chủ Nhật nghỉ).
- **Chặn spam & Kiểm tra ảnh**:
  - Yêu cầu ít nhất 1 ảnh minh chứng.
  - Tự động nén ảnh qua HTML5 Canvas trước khi tải lên máy chủ.
  - Chặn gửi liên tiếp trong vòng 120 giây.
- **Gửi Check-in (`btnSubmit`)**: Đóng gói `FormData` gồm tên điểm bán, địa chỉ, toạ độ GPS, file ảnh selfie và ảnh quầy kệ, gửi tới `POST /api/retail-checkin/submit`.
- **Xem Lịch Sử (`loadHistory`)**: Gọi `GET /api/retail-checkin/history?telegram_id=...&chat_id=...&date=YYYY-MM-DD` để hiển thị danh sách các điểm đã ghé trong ngày, tình trạng hợp lệ và liên kết Google Maps của từng điểm.

---

## 4. Quy Tắc Phát Triển & Mở Rộng

1. **Không viết logic phức tạp hoặc CSS inline vào file HTML shell**: Giữ `retail_checkin.html` ở dạng semantic markup thuần túy.
2. **Tuân thủ Design Tokens**: Sử dụng các biến CSS token từ `/mini-app/shared-ui/theme-tokens.css` (`var(--brand)`, `var(--card)`, `var(--ink)`, `var(--line-soft)`,...).
3. **Tương thích ngược**: Bất kỳ thay đổi nào về tham số query URL hoặc tên API endpoint phải được cập nhật tương ứng ở `domains/retail-checkin/interfaces/miniapp-api/`.
