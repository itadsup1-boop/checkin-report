# Kế Hoạch Triển Khai Hệ Thống KPI & Chấm Công Clinic

Tài liệu này vạch ra kiến trúc logic và cách vận hành chi tiết nhất cho hệ thống Bot + Mini App quản lý thời gian làm việc, nhằm giải quyết các lỗ hổng nhân sự có thể lách luật.

## 1. Trả Lời Câu Hỏi Cốt Lõi Của Bạn

### A. Về Tài Khoản (Dùng cũ hay Tạo mới?)
Đề xuất: Tạo mới (Đăng ký lại từ đầu). 
Lý do: 
- Hệ thống mới này sẽ chạy ở một Group mới, lưu trữ dữ liệu hoàn toàn khác (Tiền phạt, lịch trực, check-in video). 
- Việc tách bạch DB giúp bạn không bị dính dáng với dữ liệu rác bên hệ thống Lịch Hẹn cũ, đồng thời loại bỏ các nhân sự đã nghỉ việc.
- Ở Bot mới, ta sẽ có nút "Đăng Ký Tài Khoản" như ảnh bạn gửi. Nhân sự chỉ cần bấm vào, nhập Tên + Bộ phận là xong rất nhanh.

### B. Về Lỗ Hổng Lách Luật "Đăng ký ca 1, đi muộn lén sửa thành ca 2"
Đề xuất: Áp dụng cơ chế CHỐT LỊCH (LOCK SCHEDULE).

1. Ai là người nhập lịch? 
   - Trừ khi Clinic của bạn có lễ tân chuyên xếp lịch cho mọi người, còn lại tối ưu nhất là: Nhân viên TỰ NHẬP lịch của mình cho cả tuần tiếp theo vào Mini App.
   - Hạn chót: Ví dụ 20:00 Chủ Nhật hàng tuần.
2. Khóa lịch (Chốt sổ):
   - Qua 20:00 Chủ Nhật, hệ thống Khóa chặt toàn bộ lịch của tuần sau. 
   - Kể từ lúc này, nhân viên KHÔNG THỂ TỰ SỬA lịch của mình (Ví dụ: Hôm nay thứ 3, không thể mở Mini App lên tự đổi thành ca 2).
3. Xử lý sự cố: Nếu nhân sự có việc gấp thật sự muốn đổi ca 1 xuống ca 2, bắt buộc phải báo Quản lý. Chỉ Quản lý (Admin) mới có quyền vào sửa lịch cho nhân viên trong ngày.
=> *Điều này triệt tiêu hoàn toàn khả năng nhân sự lươn lẹo đi muộn rồi lén đổi ca. Bot cứ auto lấy đúng ca đã chốt lúc đầu để trừ tiền.*

---

## 2. Kiến Trúc Cơ Sở Dữ Liệu (Database PostgreSQL)

Hệ thống sẽ gồm 4 bảng chính để xử lý gọn gàng dữ liệu:
- users: ID, Telegram_ID, Tên, Chức vụ (Role - dùng để chặn 2 người cùng chức vụ nghỉ cùng ngày).
- schedules: ID, User_ID, Ngày (Date), Loại ca (Ca 1 / Ca 2 / Nghỉ), Trạng thái (Pending / Locked).
- check_ins: ID, User_ID, Giờ gửi video, Trạng thái Duyệt (Đạt / Phạt 50k - Lỗi trang phục).
- penalties: ID, User_ID, Ngày, Loại phạt (Muộn / Vắng mặt / Trang phục), Số tiền, Đã nộp quỹ chưa (Boolean).

---

## 3. Luồng Hoạt Động Của Telegram Bot

Bot sẽ có Menu tương tự ảnh bạn gửi, kèm theo tính năng "Lắng nghe" group âm thầm:

1. Nghe Video Check-in: Bắt event bất kỳ ai gửi Video/Video Note vào nhóm -> Tự động lưu timestamp tin nhắn -> Đối chiếu với ca làm hôm nay của người đó -> Báo kết quả (Đúng giờ/Đi muộn).
2. Nghe Báo Cáo: Quét từ khóa mọi tin nhắn text:
   - Nếu có từ khóa (muộn|trễ) -> Ghi nhận có báo trước (nếu trước 30p thì giảm 50% phạt).
   - Nếu có từ khóa (nghỉ|ốm) -> Ghi nhận báo nghỉ đột xuất.
3. Giao tiếp Menu: Các nút như Đăng Ký, Xếp Lịch/Ca, Bảng Tiền Phạt -> Bấm vào sẽ mở Mini App (giao diện Web).

---

## 4. Giao Diện & Tính Năng Telegram Mini App

1. Giao diện Nhân Viên:
   - Xếp ca: Bảng 7 ngày. Nhân viên chọn ngày và ca. (Hệ thống sẽ check: Nếu có 2 người cùng vị trí nghỉ cùng ngày -> Hiện cảnh báo đỏ và không cho lưu. Nếu nghỉ 2 ngày liên tiếp -> Chặn, bắt nộp minh chứng đi viện/cưới).
   - Lịch sử cá nhân: Xem tháng này mình đã muộn bao nhiêu phút, nợ quỹ bao nhiêu tiền.
   
2. Giao diện Quản Lý (Admin):
   - Duyệt Video Check-in: Hiển thị danh sách Video nhân viên gửi hôm nay. Quản lý xem qua và bấm nút [Đạt] hoặc [Phạt Tác Phong 50k].
   - Sửa ca khẩn cấp: Admin có quyền ghi đè, sửa ca của bất kỳ ai bất chấp việc hệ thống đã Lock.
   - Quỹ Phạt: Bảng tổng kết số tiền thu được của phòng ban.
   - Hàng Đợi Khách (Queue): List nhân sự làm hôm nay, Bot tự động đẩy người đi muộn xuống cuối mảng.

---

## 5. Chuỗi Thông Báo Tự Động & Tính Phạt (Cronjobs & Events)

Đây là kịch bản chuẩn hóa dựa trên logic thực tế (Ví dụ cho Ca 1 - 08:30):

- 08:00 (Trước 30p): Nhắc nhở vào ca. Hết giờ nhận báo muộn/nghỉ để được giảm 50% phạt.
- 08:25 (Trước 5p): Bot điểm danh những ai chưa gửi video. Cảnh báo sắp muộn.
- 08:31 (Vào ca 1p): Thông báo Danh sách đã đi muộn. 
  *(Lúc này hệ thống chỉ réo tên cảnh báo, chưa chốt số tiền phạt vì chưa biết nhân sự sẽ đi muộn bao nhiêu phút).*
- Sự kiện Tự động (Tính tiền khi Check-in): 
  Ngay khoảnh khắc người đi muộn gửi video check-in vào group (VD: lúc 08:45), Bot lập tức bấm giờ, tính ra số phút muộn, đối chiếu với công thức và báo số tiền phạt ngay lập tức (VD: *Thuong check-in muộn 15p, nộp quỹ 20k*).
- 10:00 (Quá 90 phút): Chốt danh sách Nghỉ không phép. Những ai quá 90 phút (so với giờ vào ca) mà vẫn chưa có video check-in, hệ thống tự động ghi nhận là Nghỉ không phép và áp mức phạt kịch khung 200.000đ.

---

## 6. Tích Hợp Google Sheets (Đồng Bộ Dữ Liệu)

Toàn bộ dữ liệu vận hành sẽ được đồng bộ tự động lên Google Sheets để Ban Giám Đốc hoặc Kế Toán/Nhân Sự dễ dàng theo dõi, tổng hợp lương mà không cần thao tác trên Mini App.

- Sheet "Lịch Làm Việc": Tự động kết xuất (export) lịch đã chốt của tuần ra Sheet để có cái nhìn tổng quan toàn bộ ca trực của Clinic.
- Sheet "Chấm Công & Tiền Phạt": Ghi nhận Real-time từng lượt check-in (kèm link tải/xem Video gốc trên Telegram để kế toán có thể đối chiếu lại khi cần), ghi nhận số phút đi muộn, lý do vắng mặt đột xuất và số tiền phạt tương ứng của từng cá nhân theo từng ngày.
- Cơ chế hoạt động: Hệ thống sử dụng Google Sheets API để Append Row (thêm dòng mới) hoặc cập nhật ô dữ liệu ngay khi có sự kiện phát sinh (VD: lúc gửi video check-in thành công hoặc lúc Bot tự động chốt sổ cuối ngày).

> [!IMPORTANT]
> Bản kế hoạch đã được cập nhật logic tính phạt (Phần 5): Báo đi muộn tại phút 31 -> Tính tiền chính xác tại thời điểm gửi video -> Phạt kịch khung 200k nếu quá 90 phút.