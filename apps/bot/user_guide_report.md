# 📖 HƯỚNG DẪN SỬ DỤNG BOT BÁO CÁO & KPI (ROLE: REPORT)

---

## 👤 dành cho nhân viên

### 1. 👤 Đăng Ký Tài Khoản
- **Cách 1**: Gõ lệnh trực tiếp trên nhóm chat:
  `/setup Họ và Tên` (Ví dụ: `/setup Nguyễn Văn A`)
- **Cách 2**: Bấm nút **[👤 Đăng Ký Tài Khoản]** hiển thị dưới bảng tin của Bot.

---

### 2. 📅 Đăng Ký & Xem Lịch Làm Việc Tuần
- Gõ lệnh `/lich_tuan` hoặc bấm nút **[📅 Lịch Tuần]** để mở giao diện đăng ký ca làm việc (Ca sớm, Ca muộn, Cả ngày, Xin nghỉ).
- Lịch làm việc tuần giúp hệ thống quản lý ca và tự động kiểm tra giờ check-in của bạn.

---

### 3. 📹 Quay / Tải Video Check-in
- **Cách 1 (Khuyên dùng)**: Bấm nút **[📹 Check-in]** dưới tin nhắn của Bot để mở Mini-App chọn và upload video check-in.
- **Cách 2**: Gửi trực tiếp 1 video kèm nội dung có chứa từ "check" (Ví dụ: `Checkin ca sớm`).

---

### 4. 📊 Báo Cáo KPI Hằng Ngày
- **Cách 1 (Form Mini-App - Tiện lợi nhất)**: Bấm nút **[📊 Báo Cáo KPI]** để mở form điền số liệu (Số tin nhắn, Doanh thu, Lịch hẹn khách hàng, Upload ảnh chứng minh).
- **Cách 2 (Cú pháp nhắn trực tiếp)**: Gõ báo cáo theo lệnh Sếp cài đặt (Mặc định: `#baocao`).
  *Mẫu cú pháp:*
  ```text
  #baocao
  💬 Số tin nhắn: 50
  💰 Doanh thu: 1.500.000
  📅 Lịch khách:
  1. Nguyễn Văn B - Dịch vụ Da - 1/2
  ```

---

### 5. 🏖️ Xin Nghỉ Phép
- Bấm nút **[🏖️ Xin Nghỉ Phép]** trên bảng tiện ích của Bot.
- Hệ thống sẽ ghi nhận trạng thái nghỉ cho ngày hôm nay và xóa các nhắc nhở báo cáo KPI của bạn.

---

### 6. 🆔 Kiểm Tra Telegram ID Cá Nhân
- Gõ lệnh `/myid` để lấy dãy số Telegram ID cá nhân dùng khi phân quyền hoặc kiểm tra thông tin.

---

### ⚠️ LƯU Ý QUAN TRỌNG:
- **Tài khoản bị vô hiệu hóa**: Nếu tài khoản của bạn bị Quản lý vô hiệu hóa trên WebAdmin, bạn sẽ không nhận được nhắc nhở và không thể nộp báo cáo/check-in cho đến khi được mở lại.
- **Nợ ảnh minh chứng**: Báo cáo KPI cần gửi kèm đủ ảnh minh chứng trước deadline (Mặc định: sau giờ báo cáo 2 tiếng). Nếu trễ hạn, báo cáo sẽ bị chuyển thành "Nợ ảnh" và ghi nhận vi phạm.

---

## 👨‍💼 DÀNH CHO QUẢN LÝ (SẾP)

1. `/taocaulenh <cú pháp>` : Đặt lệnh trigger báo cáo cho nhóm (Ví dụ: `/taocaulenh #baocao`)
2. `/hengio <hh:mm>` : Đặt giờ nhắc nộp báo cáo hằng ngày (Ví dụ: `/hengio 17:30`). Deadline nợ ảnh tự động +2 tiếng.
3. `/phatvipham <số tiền>` : Đặt mức phạt cho lỗi Thiếu KPI / Nợ Ảnh (Ví dụ: `/phatvipham 100k`)
4. `/phatbaocao <số tiền>` : Đặt mức phạt cho lỗi Trốn / Bỏ báo cáo (Ví dụ: `/phatbaocao 500k`)
5. `/kpi <số lượng>` : Cài đặt chỉ tiêu KPI chung cho nhóm (Ví dụ: `/kpi 40`)
