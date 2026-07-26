# ⏰ HƯỚNG DẪN SỬ DỤNG BOT CHẤM CÔNG & ĐIỂM DANH (ROLE: TIMEKEEP)

---

## 👤 DÀNH CHO NHÂN VIÊN

### 1. 👤 Đăng Ký Tài Khoản
- **Cách 1**: Gõ lệnh `/setup Họ và Tên` trên nhóm chat chấm công (Ví dụ: `/setup Nguyễn Văn A`).
- **Cách 2**: Bấm lệnh `/app` hoặc `/chamcong` để mở Menu tiện ích và bấm **[👤 Đăng Ký Tài Khoản]**.

---

### 2. 📅 Đăng Ký Ca Làm Việc & Lịch Tuần
- Gõ lệnh `/lich_tuan` hoặc bấm nút **[📅 Lịch Tuần]** trên Menu Tiện Ích.
- Chọn ca làm việc hằng ngày: **Ca Sớm**, **Ca Muộn**, **Cả Ngày**, hoặc **Xin Nghỉ**.
- Đăng ký lịch tuần giúp hệ thống theo dõi ca làm việc và tính điểm danh chính xác.

---

### 3. 📹 Check-in Điểm Danh (Video)
- **Cách 1 (Khuyên dùng - Nhanh & Chọn video có sẵn)**: Bấm nút **[📹 Check-in]** trên Menu tin nhắn của Bot để mở Mini-App chọn video check-in từ thư viện máy và upload.
- **Cách 2 (Gửi video trực tiếp)**: Gửi 1 clip video ngắn vào nhóm chat kèm dòng chữ có từ "check" (Ví dụ: `checkin ca sớm`).

---

### 4. ⏰ Giờ Nhắc Nhở & Tính Phạt Đi Muộn
- **Trước giờ vào ca 3 phút**: Bot tự động phát tin nhắc nhở danh sách nhân sự chưa check-in.
- **Sau giờ vào ca 1 phút**: Bot tự động thông báo danh sách nhân sự đi muộn.
- **Tính tiền phạt**: Khi nhân viên gửi check-in muộn, hệ thống sẽ tự động tính số phút đi muộn và tiền phạt trừ lương (trừ trường hợp nhân sự được thiết lập **Miễn Check-in** trên WebAdmin).

---

### 5. 🆔 Kiểm Tra Telegram ID
- Gõ lệnh `/myid` để hiển thị Telegram ID của bạn.

---

## 👨‍💼 DÀNH CHO QUẢN LÝ (SẾP / ADMIN)

1. **Quản lý Nhân Sự & Miễn Check-in**:
   - Truy cập **WebAdmin** -> Mục **Quản lý Nhân sự**.
   - Có thể bật tùy chọn **Miễn Check-in** cho nhân sự đặc biệt (những người này sẽ không bị nhắc tên hoặc tính tiền phạt đi muộn).
   - Có thể **Vô hiệu hóa** nhân viên đã nghỉ việc (ngăn chặn mọi nhắc nhở hoặc chấm công).

2. **Duyệt Đơn Xin Nghỉ / Đơn Đi Muộn**:
   - Các yêu cầu xin nghỉ/đi muộn sẽ hiển thị kèm nút **[✅ Duyệt]** và **[❌ Từ Chối]** trực tiếp trên nhóm Telegram để Sếp phê duyệt nhanh.

3. **Cấu hình Giờ Vào Ca**:
   - Cấu hình khung giờ bắt đầu Ca sớm, Ca muộn và mức phạt đi muộn trực tiếp trong mục **Cài đặt Nhóm** trên WebAdmin.
