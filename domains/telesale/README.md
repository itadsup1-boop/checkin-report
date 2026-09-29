# Domain: Báo Cáo Telesale (`bot_role = 'telesale'`)

Toàn bộ nghiệp vụ tiếp nhận, tự động tính toán, nhắc nhở, đối chiếu lịch nghỉ OFF, phạt chậm nộp và đồng bộ Google Sheet của nhóm **Telesale** nằm trong thư mục này.

Module được tổ chức theo chuẩn **Clean Architecture**, cô lập hoàn toàn với các domain khác.

---

## 1. Cấu Trúc Thư Mục

```text
domains/telesale/
├── index.js                                Cổng vào công khai DUY NHẤT (Public API)
├── README.md                               Tài liệu kiến trúc và hướng dẫn nghiệp vụ
│
├── domain/                                 Thuần nghiệp vụ — CẤM import Express/PG/Telegraf
│   ├── telesale-rules.js                   Tính toán các chỉ số tự động cộng, % tỷ lệ, cảnh báo <15%, <25%, thưởng >19%
│   └── telesale-messages.js                Định dạng tin nhắn báo cáo cá nhân, nhắc nhở 18h, phạt 19h, tổng kết đội
│
├── application/                            Use Cases
│   ├── submit-telesale-report.js           Xử lý nộp báo cáo (lưu DB, tính luỹ kế tháng, đồng bộ Sheet, báo Telegram)
│   ├── get-telesale-bootstrap.js           Nạp dữ liệu ban đầu cho Mini App 10s
│   ├── send-telesale-reminder.js           Nhắc nộp báo cáo lúc 18:00
│   ├── scan-telesale-deadline.js           Quét hạn 19:00, bỏ qua lịch nghỉ OFF, áp phạt 50.000đ
│   └── summarize-daily-telesale.js         Tổng kết báo cáo toàn đội lúc 19:00
│
├── infrastructure/                         Tương tác DB & Google Sheet
│   ├── postgres/telesale-repository.js     CRUD bảng `telesale_daily_reports`, luỹ kế tháng, kiểm tra lịch off, phạt
│   └── google-sheet/telesale-sheet-sync.js Đồng bộ Sheet Tổng Hợp và Sheet từng nhân sự
│
├── interfaces/                             Cổng kết nối
│   ├── telegram/register-telesale-handler.js Lệnh /telesale, /tongket_tele, nút mở Mini App
│   ├── miniapp-api/telesale-routes.js      REST API: /api/telesale/bootstrap, /api/telesale/submit
│   └── cron/register-telesale-crons.js     Cron 18:00 (nhắc nhở) và 19:00 (quét phạt & tổng kết)
│
└── tests/                                  Bộ kiểm thử tự động
    ├── telesale-rules.test.js              Unit test công thức, tỷ lệ, cảnh báo, thưởng
    └── telesale-flow.test.js               Integration test luồng submit, hạn chót, đồng bộ lịch off và phạt
```

---

## 2. Quy Tắc Nghiệp Vụ

1. **Phạm vi tính toán 6 mục BOT tự cộng**:
   - `Tổng lịch cộng dồn`: Trong ngày = Lịch PV mới + Lịch PV cũ.
   - `Tổng DS cộng dồn tháng`: Luỹ kế tháng = Tổng doanh số từ ngày 1 đầu tháng đến hết hôm nay.
   - `Tổng khách tới cộng dồn`: Trong ngày = Tổng tới hôm nay.
   - `Tỷ lệ khách tới / doanh số cộng dồn`: Trong ngày = TỔNG DS hnay / Tổng tới hôm nay.
   - `Tỷ lệ lịch cộng dồn`: Trong ngày = (Tổng lịch / Số nhận) * 100% (⚠️ Cảnh báo < 25%).
   - `Tỉ lệ tới cộng dồn`: Trong ngày = (Tổng tới / Số nhận) * 100% (⚠️ Cảnh báo < 15%, 🌟 Thưởng > 19%).
2. **Khung giờ & Chế tài**:
   - 18:00: Bot nhắc nộp báo cáo.
   - 19:00: Hạn chót. Quá 19:00 nhân viên chưa nộp (mà không có lịch ca OFF hoặc đơn nghỉ phép) sẽ bị phạt 50.000đ/lần vào `tk_penalties`.
   - Trước 19:00: Nhân viên có thể mở lại Mini App cập nhật lại số liệu.
3. **Google Sheets**:
   - Ghi vào Sheet Tổng Hợp và Tab cá nhân của từng nhân viên trên Spreadsheet `1gQYXoylEysKKqUpYMxAzLw1nA7KC89eC-FO4kSzhlYU`.
