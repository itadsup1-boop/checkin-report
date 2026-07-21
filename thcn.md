# Tổng Hợp Chức Năng Hệ Thống

Tài liệu này mô tả chức năng của hệ thống theo mã nguồn hiện tại trong dự án. Hệ thống là tổ hợp Telegram Bot, Mini App, Web Admin, API backend, PostgreSQL và tích hợp Google Sheets để quản lý KPI, báo cáo, lịch khách hàng, chấm công, lịch làm việc, nghỉ phép và xử lý vi phạm.

## 1. Tổng Quan Hệ Thống

Hệ thống gồm các khối chính:

- **Telegram Bot KPI**: nhận báo cáo KPI, kiểm tra form, yêu cầu ảnh minh chứng, phát hiện ảnh trùng, nhắc nợ ảnh, tính phạt và ghi Google Sheet.
- **Telegram Bot Chấm Công**: đăng ký nhân sự, đăng ký lịch tuần, xin nghỉ/đi muộn, check-in video, tính phạt đi muộn.
- **Mini App Telegram**: giao diện web mở trong Telegram để nhân viên điền báo cáo, đăng ký lịch, check-in, xin nghỉ và nộp ảnh chứng thực.
- **Web Admin**: giao diện quản trị cho admin/HR/quản lý để xem nhân sự, KPI, check-in, lịch làm, nghỉ phép, quỹ phép và cấu hình nhóm.
- **Backend API**: cung cấp API cho Web Admin và proxy một số API sang bot server.
- **Database PostgreSQL**: lưu thông tin nhân sự, nhóm, báo cáo, lịch, check-in, đơn nghỉ, phạt và cấu hình.
- **Google Sheets**: lưu báo cáo KPI, tổng hợp phạt và lịch khách hàng.

## 2. Thành Phần Mã Nguồn Chính

| Thành phần | Đường dẫn | Vai trò |
| --- | --- | --- |
| API/Web server | `apps/api/index.js` | API cho Web Admin, phục vụ frontend build, proxy Mini App |
| Bot KPI | `apps/bot/index.js` | Xử lý báo cáo KPI, lịch khách, ảnh minh chứng, Google Sheet |
| Bot chấm công | `apps/bot/timekeep_bot.js` | Đăng ký nhân sự, lịch làm, check-in video, nghỉ phép, tính phạt muộn |
| Web Admin | `apps/web-admin/src` | Giao diện quản trị React |
| Database | `packages/database` | Kết nối PostgreSQL và migration |
| Mini App | `apps/bot/public` | Các trang HTML chạy trong Telegram Web App |
| Script khởi động | `khoi_dong_he_thong_kpi.sh` | Khởi động PM2 và Cloudflare Tunnel |

## 3. Chức Năng Báo Cáo KPI

### 3.1. Nhận Báo Cáo Từ Telegram

Nhân viên có thể nộp báo cáo bằng cách nhắn trong nhóm Telegram hoặc điền qua Mini App. Bot nhận diện báo cáo theo:

- Lệnh mặc định: `#baocao`.
- Lệnh riêng theo nhóm, cấu hình bằng `/taocaulenh #tenlenh`.
- Một số câu tự nhiên có chứa từ khóa báo cáo, doanh thu, khách, tin nhắn và số liệu.

Form báo cáo chuẩn gồm:

```text
#baocao
Số tin nhắn: 40
Doanh thu: 12tr
Lịch khách:
Nguyễn Văn A - Dịch vụ X - 3/10
```

Hệ thống cũng hỗ trợ form ngắn kiểu cũ:

```text
#baocao 5
```

### 3.2. Kiểm Tra Form Báo Cáo

Bot kiểm tra các thành phần bắt buộc:

- Số tin nhắn gửi.
- Doanh thu.
- Lịch khách.

Nếu thiếu mục, bot trả lời lỗi và yêu cầu nhân viên điền đủ form. Với lịch khách, nếu có khách thì cần có định dạng rõ ràng như `3/10` hoặc ghi nội dung tái khám. Nếu không có khách, nhân viên có thể ghi `0`, `không có` hoặc tương đương.

### 3.3. Tính KPI

Hệ thống lấy KPI của nhân viên từ trường `current_kpi_target`. Nếu chưa có, bot dùng mặc định `40`.

Khi có báo cáo:

- Lấy số tin nhắn thực tế từ báo cáo.
- So sánh với KPI yêu cầu.
- Tính số lượng thiếu.
- Xác định trạng thái đạt hoặc không đạt.
- Lưu vào bảng `daily_reports`.
- Đẩy dữ liệu sang Google Sheet.

### 3.4. Cập Nhật Báo Cáo

Nhân viên có thể cập nhật báo cáo trong ngày qua Mini App. Hệ thống kiểm tra báo cáo cũ:

- Nếu KPI mới cao hơn KPI cũ, chỉ yêu cầu nộp thêm ảnh cho phần tăng thêm.
- Nếu KPI mới thấp hơn hoặc bằng KPI cũ, không yêu cầu thêm ảnh.
- Báo cáo mới nhất vẫn được ghi lại vào hệ thống và Google Sheet.

## 4. Ảnh Minh Chứng KPI

### 4.1. Yêu Cầu Ảnh

Nếu số tin nhắn thực tế lớn hơn 0, hệ thống yêu cầu ảnh minh chứng. Số ảnh cần nộp được tính như sau:

- Số ảnh theo KPI thực tế.
- Nếu có doanh thu, cộng thêm 1 ảnh.

Ví dụ: báo cáo 10 tin nhắn và có doanh thu thì cần 11 ảnh.

### 4.2. Theo Dõi Ảnh Còn Thiếu

Khi nhân viên mới gửi báo cáo nhưng chưa đủ ảnh, hệ thống tạo bản ghi trong `pending_reports` với trạng thái `WAITING_PHOTOS`.

Hệ thống lưu:

- Telegram ID.
- Group ID.
- Nội dung báo cáo gốc.
- KPI thực tế.
- Số ảnh yêu cầu.
- Số ảnh đã nhận.
- Hạn chót nộp ảnh.
- Trạng thái xử lý.

### 4.3. Nhắc Nợ Ảnh

Cron job quét mỗi phút để xử lý các báo cáo đang chờ ảnh:

- Nhắc khi còn 15 phút.
- Cảnh báo khi còn 5 phút.
- Nhắc nếu nhân viên đã gửi một phần ảnh nhưng 5 phút không gửi tiếp.
- Nếu quá hạn, hệ thống chốt báo cáo với trạng thái nợ ảnh.

### 4.4. Xử Lý Nợ Ảnh

Nếu quá hạn mà chưa đủ ảnh:

- Báo cáo vẫn được lưu.
- Metadata ghi lại số ảnh thiếu.
- Google Sheet ghi tình trạng nợ ảnh.
- Có thể tính phạt vi phạm nếu nhóm đang bật mức phạt.

### 4.5. Phát Hiện Ảnh Trùng

Hệ thống dùng perceptual hash để phát hiện ảnh cũ hoặc ảnh giống ảnh người khác đã nộp.

Khi phát hiện nghi vấn:

- Bot gửi cảnh báo vào nhóm.
- Bot gửi ảnh gốc và ảnh mới để quản lý đối chiếu.
- Hash ảnh mới được lưu vào DB để dùng cho các lần kiểm tra sau.

## 5. Phạt KPI Và Vi Phạm Báo Cáo

### 5.1. Phạt Thiếu KPI / Nợ Ảnh

Quản lý cấu hình mức phạt bằng:

```text
/phatvipham 100k
```

Mức phạt này áp dụng cho các lỗi:

- Thiếu KPI.
- Nợ ảnh minh chứng.

Theo logic hiện tại, hệ thống ưu tiên tính một lần phạt chung trong ngày cho nhóm lỗi này.

### 5.2. Phạt Không Nộp Báo Cáo

Quản lý cấu hình mức phạt bằng:

```text
/phatbaocao 500k
```

Khi đến giờ nhắc báo cáo, bot liệt kê những người chưa nộp. Sau giờ nhắc cộng thêm 2 tiếng, nếu vẫn chưa có báo cáo, bot chốt danh sách không báo cáo và ghi phạt.

### 5.3. Ghi Google Sheet Phạt

Các lỗi phạt được ghi vào sheet tổng theo tháng, ví dụ dạng `TỔNG PHẠT T7-2026`.

Thông tin ghi nhận gồm:

- Nhân viên.
- Mã nhân viên.
- Telegram ID.
- Tổng tiền phạt.
- Lịch sử vi phạm.

Nếu nhân viên đã bị phạt trong ngày, hệ thống không cộng dồn tiền lần nữa mà chỉ bổ sung lịch sử lỗi.

## 6. Lệnh Telegram KPI

| Lệnh | Chức năng |
| --- | --- |
| `/myid` | Lấy Telegram ID cá nhân |
| `/setup <Họ tên>` | Đăng ký hoặc liên kết nhân viên với Telegram ID |
| `/menu` | Hiển thị hướng dẫn sử dụng bot |
| `/app`, `/form`, `/lamviec`, `/tienich`, `/start` | Mở bảng tiện ích nhân viên |
| `/hengio HH:MM` | Đặt giờ nhắc báo cáo hằng ngày |
| `/lichbaocao HH:MM` | Đặt giờ chốt báo cáo |
| `/kpi 40` | Cập nhật KPI chung cho toàn bộ nhân viên trong nhóm |
| `/taocaulenh #baocao` | Đặt câu lệnh báo cáo cho nhóm |
| `/phatvipham 100k` | Cấu hình phạt thiếu KPI hoặc nợ ảnh |
| `/phatbaocao 500k` | Cấu hình phạt không nộp báo cáo |
| `/batnhanlich` | Bật nhận thông báo lịch khách hàng cho nhóm |
| `/tatnhanlich` | Tắt nhận thông báo lịch khách hàng |
| `/lich` | Mở hệ thống đặt/check lịch khách hàng |
| `/xoalich <tên hoặc mã lịch>` | Hủy lịch khách trong ngày |

Một số lệnh quản trị kiểm tra quyền bằng danh sách `ADMIN_IDS` trong `.env`.

## 7. Mini App Báo Cáo

Mini App báo cáo nằm tại `apps/bot/public/form.html`.

Chức năng:

- Lấy Telegram user từ Telegram WebApp.
- Lấy `chat_id` từ start parameter.
- Tải báo cáo hôm nay nếu đã có để cho phép cập nhật.
- Nhập số tin nhắn, doanh thu, lịch khách.
- Upload ảnh minh chứng.
- Gửi báo cáo qua API `/api/bot/submit-report`.
- Nếu ảnh chưa đủ, bot yêu cầu nhân viên gửi thêm ảnh trong nhóm.

## 8. Quản Lý Lịch Khách Hàng

### 8.1. Thêm Lịch Khách

Nhân viên có thể tạo lịch khách qua Mini App hoặc báo cáo. Thông tin lưu gồm:

- Nhân viên phụ trách.
- Tên khách hàng.
- Số điện thoại.
- Dịch vụ.
- Số buổi.
- Doanh thu hoặc số tiền thu.
- Thời gian hẹn.
- Trạng thái lịch.

Dữ liệu lưu trong bảng `customer_appointments`.

### 8.2. Kiểm Tra Trùng Lịch

Khi thêm hoặc sửa lịch, hệ thống kiểm tra trong khoảng gần 1 tiếng quanh giờ hẹn. Nếu đã có lịch khác, hệ thống báo lỗi để tránh trùng khách.

Lịch khẩn cấp có thể bỏ qua kiểm tra trùng.

### 8.3. Sửa Và Hủy Lịch

Hệ thống hỗ trợ:

- Sửa tên khách.
- Sửa số điện thoại.
- Sửa giờ hẹn.
- Hủy lịch kèm lý do.
- Hủy qua Mini App hoặc qua lệnh `/xoalich`.

Khi hủy, Google Sheet lịch khách cũng được cập nhật nếu có cấu hình.

### 8.4. Thông Báo Lịch Khách

Nếu nhóm bật nhận lịch bằng `/batnhanlich`, bot sẽ:

- Gửi báo cáo lịch ngày mai lúc 20:02.
- Gửi tổng kết lịch hôm nay lúc 22:00.
- Nhắc đúng giờ khi khách đến.

Tin nhắc đúng giờ có nút:

- `Đã đến`.
- `Hủy lịch / Rời lịch`.

### 8.5. Xác Nhận Khách Đến

Khi khách đến, người tạo lịch bấm `Đã đến`. Hệ thống:

- Cập nhật lịch sang `ARRIVED`.
- Đánh dấu nợ 1 ảnh chứng thực.
- Cập nhật Google Sheet.
- Chỉnh nội dung tin nhắn Telegram để thể hiện khách đã đến.

### 8.6. Hủy Lịch Và Lý Do Hủy

Khi bấm hủy, bot yêu cầu chọn lý do:

- Khách bom lịch.
- Bận đột xuất / xin dời ngày.
- Chưa đủ tài chính / chê đắt.
- Đã qua cơ sở khác.
- Lý do khác qua Mini App.

Lý do hủy được lưu DB và cập nhật Google Sheet.

### 8.7. Ảnh Chứng Thực Khách Đã Đến

Với khách đã đến, nhân viên phải nộp ảnh chứng thực. Có 2 cách:

- Upload qua API `/api/upload-proof`.
- Reply ảnh trực tiếp vào tin nhắn bot có trạng thái `ĐÃ ĐẾN`.

Khi nhận ảnh:

- Ảnh được lưu local.
- `is_photo_debt` chuyển về `FALSE`.
- `proof_image` được cập nhật.
- Google Sheet được cập nhật link ảnh.
- Bot gửi thông báo đã nhận ảnh.

## 9. Chấm Công Và Lịch Làm Việc

### 9.1. Đăng Ký Tài Khoản Chấm Công

Nhân viên mở Mini App đăng ký từ bot. Dữ liệu đăng ký gồm:

- Telegram ID.
- Telegram username.
- Họ tên.
- Vai trò.
- Nhóm Telegram.

Dữ liệu lưu vào `tk_users` và `tk_groups`.

Nếu nhân viên đã tồn tại trong nhóm, hệ thống cập nhật lại họ tên và vai trò.

### 9.2. Đăng Ký Lịch Tuần

Nhân viên đăng ký lịch làm việc tuần sau qua Mini App `schedule.html`.

Các ca được hỗ trợ:

- `CA_SANG`.
- `CA_CHIEU`.
- `FULL_DAY`.
- `OFF`.

Quy tắc với nhân viên thường:

- Không được sửa lịch tuần hiện tại hoặc lịch cũ.
- Không được sửa lịch tuần sau nếu đã quá 20:00 Chủ Nhật.
- Không được đăng ký nghỉ trùng ngày với người cùng vai trò.
- Nếu nghỉ từ 2 ngày trở lên trong tuần, phải nộp ảnh minh chứng.

Admin có thể sửa lịch của người khác. Khi admin sửa lịch, bot gửi tin nhắn riêng cho nhân viên bị thay đổi.

### 9.3. Lưu Lịch

Lịch được lưu vào `tk_schedules` với:

- Nhóm.
- Nhân viên.
- Ngày.
- Ca.
- Trạng thái khóa.
- Ảnh minh chứng nếu có.
- Người cập nhật nếu admin chỉnh sửa.

## 10. Check-in Video

Nhân viên check-in qua Mini App `checkin.html`.

Luồng xử lý:

1. Mini App mở camera.
2. Nhân viên quay video check-in.
3. Video được gửi về API `/api/timekeep/checkin/save`.
4. Hệ thống lưu file vào `apps/bot/public/uploads/checkins`.
5. Nếu video là `webm`, hệ thống convert sang `mp4` bằng `ffmpeg`.
6. Check-in được lưu vào `tk_check_ins`.
7. Bot gửi video vào nhóm Telegram.

Admin có thể quản lý check-in trên Web Admin:

- Lọc theo ngày.
- Xem nhân viên, vai trò, nhóm.
- Sửa giờ check-in.
- Đổi trạng thái.
- Thêm ghi chú.
- Thêm check-in thủ công.

## 11. Xin Nghỉ Và Đi Muộn

### 11.1. Gửi Đơn

Nhân viên mở Mini App `urgent_leave.html` để gửi đơn. Loại yêu cầu:

- Nghỉ cả ngày.
- Nghỉ nửa ngày sáng.
- Nghỉ nửa ngày chiều.
- Xin đi muộn.

Dữ liệu gồm:

- Nhân viên.
- Nhóm.
- Ngày xin phép.
- Loại yêu cầu.
- Số phút đi muộn nếu có.
- Lý do.
- Ảnh minh chứng nếu có.
- Trạng thái `PENDING`.

Dữ liệu lưu trong `tk_leave_requests`.

### 11.2. Duyệt Qua Telegram

Sau khi gửi đơn, bot gửi tin nhắn vào nhóm với nút:

- Duyệt.
- Từ chối.

Chỉ người nằm trong `ADMIN_IDS` được bấm duyệt/từ chối.

Khi duyệt hoặc từ chối:

- Cập nhật trạng thái trong DB.
- Sửa tin nhắn nhóm để hiển thị kết quả.
- Gửi thông báo riêng cho nhân viên nếu có thể.
- Nếu duyệt nghỉ cả ngày, lịch ngày đó được cập nhật thành `OFF`.

### 11.3. Duyệt Qua Web Admin

Web Admin có màn hình quản lý đơn nghỉ:

- Xem danh sách đơn.
- Xem ảnh minh chứng.
- Duyệt đơn.
- Từ chối đơn.
- Reset về trạng thái chờ duyệt.

Khi xử lý từ Dashboard, hệ thống cũng gửi thông báo Telegram cho nhân viên.

## 12. Tính Phạt Đi Muộn

Bot chấm công có cron quét mỗi phút để kiểm tra check-in trong ngày.

Luồng xử lý:

1. Lấy check-in đầu tiên của mỗi nhân viên trong ngày.
2. Lấy lịch làm việc tương ứng.
3. Lấy giờ bắt đầu ca từ `tk_group_settings`.
4. So sánh giờ check-in với giờ bắt đầu ca.
5. Nếu check-in muộn, kiểm tra đã có phạt `LATE` trong ngày chưa.
6. Đếm số lần đi muộn trong tháng.
7. Tính tiền phạt.
8. Lưu vào `tk_penalties`.
9. Gửi thông báo vào nhóm Telegram.

Mức phạt theo logic hiện tại:

- Lần đi muộn đầu tiên trong tháng: miễn phạt.
- Từ lần thứ 2:
  - Muộn dưới 15 phút: 20.000đ.
  - Muộn từ 15 đến dưới 90 phút: 20.000đ + 2.000đ/phút từ phút thứ 16.
  - Muộn từ 90 phút trở lên: 200.000đ.
- Nếu có đơn xin đi muộn trong ngày, tiền phạt giảm 50%.

## 13. Web Admin

Web Admin là ứng dụng React trong `apps/web-admin`.

### 13.1. Đăng Nhập

Endpoint đăng nhập:

```text
POST /api/admin/login
```

Thông tin mặc định trong mã nguồn:

```text
username: admin
password: admin123
```

Sau khi đăng nhập, token được lưu vào `localStorage`.

### 13.2. Dashboard KPI

Màn hình tổng quan hiển thị:

- Tổng nhân sự.
- Số người hoàn thành KPI.
- Số người chưa đạt KPI.
- Tỷ lệ hoàn thành.
- Danh sách nhân viên KPI.

Admin có thể:

- Thêm nhân viên.
- Xóa nhân viên.
- Cập nhật KPI nhân viên.
- Bật/tắt yêu cầu nộp báo cáo.

### 13.3. Quản Lý Nhân Sự Chấm Công

Màn hình nhân sự chấm công hiển thị dữ liệu từ `tk_users`:

- Họ tên.
- Telegram ID.
- Vai trò.
- Nhóm.
- Số phép năm.
- Ngày đăng ký.

Admin có thể sửa:

- Họ tên.
- Vai trò.
- Số phép năm.

### 13.4. Quản Lý Check-in

Màn hình check-in hỗ trợ:

- Lọc check-in theo ngày.
- Xem tổng số check-in.
- Xem số check-in muộn.
- Xem số check-in có video.
- Sửa giờ check-in.
- Đổi trạng thái.
- Ghi chú admin.
- Thêm check-in thủ công.

### 13.5. Quản Lý Lịch Làm

Màn hình lịch làm hiển thị ma trận theo tuần:

- Các ngày trong tuần.
- Các ca làm.
- Danh sách nhân viên trong từng ca.
- Tổng lượt đăng ký trực.
- Tổng lượt nghỉ.
- Số nhân viên có lịch.

### 13.6. Quản Lý Nghỉ Phép Và Quỹ Phép

Màn hình nghỉ phép gồm 2 tab:

- Danh sách đơn xin nghỉ/đi muộn.
- Thống kê quỹ phép năm.

Admin có thể:

- Tìm kiếm theo tên, vai trò, lý do.
- Xem ảnh minh chứng.
- Duyệt đơn.
- Từ chối đơn.
- Reset trạng thái.
- Xem số phép đã dùng trong năm.

### 13.7. Cấu Hình Nhóm

Admin có thể cấu hình theo nhóm:

- Giờ bắt đầu ca 1.
- Giờ bắt đầu ca 2.
- Mức phạt muộn dưới 15 phút.
- Mức phạt muộn dưới 90 phút.
- Mức phạt muộn từ 90 phút trở lên.

## 14. Backend API Chính

### 14.1. API Web Admin

| Endpoint | Chức năng |
| --- | --- |
| `GET /api/health` | Kiểm tra API chạy |
| `POST /api/admin/login` | Đăng nhập admin |
| `GET /api/admin/tk-users` | Danh sách nhân sự chấm công |
| `PUT /api/admin/tk-users/:id` | Cập nhật nhân sự chấm công |
| `GET /api/admin/checkins` | Lấy danh sách check-in |
| `PUT /api/admin/checkins/:id` | Sửa check-in |
| `POST /api/admin/checkins` | Thêm check-in thủ công |
| `GET /api/admin/schedules` | Lấy lịch làm |
| `GET /api/admin/schedules/stats` | Thống kê lịch theo ngày/ca |
| `GET /api/admin/leave-requests` | Lấy danh sách đơn nghỉ |
| `PUT /api/admin/leave-requests/:id` | Duyệt/từ chối/reset đơn nghỉ |
| `GET /api/admin/leave-balances` | Thống kê quỹ phép |
| `GET /api/employees` | Danh sách nhân viên KPI |
| `POST /api/employees` | Thêm nhân viên KPI |
| `PUT /api/employees/:id/kpi` | Cập nhật KPI nhân viên |
| `PUT /api/employees/:id/report-status` | Bật/tắt yêu cầu báo cáo |
| `DELETE /api/employees/:id` | Xóa nhân viên |
| `GET /api/groups` | Danh sách nhóm |
| `PUT /api/groups/:telegram_group_id/settings` | Cập nhật cấu hình nhóm KPI |

### 14.2. API Mini App KPI

| Endpoint | Chức năng |
| --- | --- |
| `GET /api/bot/get-report-today` | Lấy báo cáo hôm nay để cập nhật |
| `POST /api/bot/submit-report` | Gửi báo cáo KPI từ Mini App |
| `GET /api/schedules` | Lấy lịch khách theo ngày |
| `GET /api/schedules/search` | Tìm lịch khách theo số điện thoại |
| `POST /api/schedules/add` | Thêm lịch khách |
| `POST /api/schedules/edit` | Sửa lịch khách |
| `POST /api/schedules/cancel` | Hủy lịch khách |
| `GET /api/photo-debts` | Lấy danh sách lịch đang nợ ảnh |
| `POST /api/upload-proof` | Upload ảnh chứng thực khách đến |

### 14.3. API Mini App Chấm Công

| Endpoint | Chức năng |
| --- | --- |
| `POST /api/timekeep/register` | Đăng ký nhân sự chấm công |
| `GET /api/timekeep/schedule/data` | Lấy dữ liệu lịch tuần |
| `POST /api/timekeep/schedule/save` | Lưu lịch tuần |
| `POST /api/timekeep/leave-request/save` | Gửi đơn nghỉ/đi muộn |
| `POST /api/timekeep/checkin/save` | Lưu check-in video |
| `PUT /api/tk_group_settings/:telegram_group_id` | Cập nhật cấu hình chấm công nhóm |

## 15. Database

### 15.1. Nhóm Bảng KPI

| Bảng | Chức năng |
| --- | --- |
| `admins` | Tài khoản quản trị theo thiết kế ban đầu |
| `telegram_groups` | Nhóm Telegram dùng cho KPI |
| `group_settings` | Cấu hình nhóm KPI: giờ nhắc, deadline, mức phạt |
| `employees` | Nhân viên KPI/telesale |
| `kpi_policies` | Chính sách KPI theo nhóm/bộ phận/vị trí |
| `employee_kpi_overrides` | KPI riêng theo nhân viên |
| `daily_reports` | Báo cáo hằng ngày |
| `penalty_records` | Bản ghi phạt KPI theo thiết kế |
| `reminder_logs` | Log nhắc báo cáo |

### 15.2. Nhóm Bảng Chấm Công

| Bảng | Chức năng |
| --- | --- |
| `tk_groups` | Nhóm Telegram cho chấm công |
| `tk_users` | Nhân sự chấm công |
| `tk_schedules` | Lịch làm việc |
| `tk_reports` | Báo cáo đi muộn/nghỉ đột xuất theo schema |
| `tk_check_ins` | Check-in video |
| `tk_penalties` | Phạt chấm công |
| `tk_leave_requests` | Đơn nghỉ phép/đi muộn |
| `tk_group_settings` | Cấu hình ca và phạt đi muộn |

### 15.3. Nhóm Bảng Bổ Sung Được Code Sử Dụng

| Bảng | Chức năng |
| --- | --- |
| `pending_reports` | Báo cáo KPI đang chờ ảnh |
| `telegram_workflows` | Lệnh báo cáo riêng theo nhóm |
| `image_fingerprints` | Hash ảnh để phát hiện ảnh trùng |
| `customer_appointments` | Lịch khách hàng |
| `schedule_notification_groups` | Nhóm nhận thông báo lịch khách |

## 16. Google Sheets Và Lưu Trữ File

### 16.1. Google Sheets KPI

Bot ghi báo cáo KPI vào Google Sheet chính:

- Ngày.
- Nhân viên.
- Mã nhân viên.
- Telegram ID.
- KPI yêu cầu.
- KPI thực tế.
- Doanh thu.
- Lịch khách.
- Tỷ lệ hoàn thành.
- Trạng thái.
- Tình trạng ảnh.
- Nội dung tin nhắn.

Ngoài sheet tổng, bot tạo tab cá nhân theo tên nhân viên và hậu tố Telegram ID.

### 16.2. Google Sheets Phạt

Bot tạo sheet tổng phạt theo tháng, lưu:

- Nhân viên.
- Mã nhân viên.
- Telegram ID.
- Tổng tiền phạt.
- Lịch sử vi phạm.

### 16.3. Google Sheets Lịch Khách

Nếu cấu hình `CUSTOMER_SPREADSHEET_ID`, lịch khách được ghi theo từng tab nhân viên:

- Ngày.
- Nhân viên.
- Mã nhân viên.
- Khách hàng.
- Số điện thoại.
- Dịch vụ.
- Buổi làm.
- Thời gian.
- Trạng thái.
- Lý do hủy.
- Thu tiền.
- Ảnh chứng thực.

### 16.4. Lưu Trữ File

Hệ thống lưu file local trong `apps/bot/public/uploads`, gồm:

- Ảnh chứng thực khách đến.
- Ảnh minh chứng lịch nghỉ.
- Video check-in.

Cron dọn file cũ quá 35 ngày có trong bot KPI.

## 17. Cron Job Tự Động

| Lịch chạy | Chức năng |
| --- | --- |
| Mỗi phút | Nhắc báo cáo KPI theo giờ nhóm |
| Mỗi phút | Chốt báo cáo KPI sau giờ nhắc + 2 tiếng |
| Mỗi phút | Quét pending report và nhắc nộp ảnh |
| Mỗi phút | Nhắc lịch khách đúng giờ |
| Mỗi phút | Kiểm tra đi muộn và ghi phạt |
| 03:00 | Dọn file upload cũ quá 35 ngày |
| 20:00 | Export dữ liệu chấm công ngày sang Google Sheet |
| 20:02 | Gửi báo cáo lịch khách ngày mai |
| 22:00 | Tổng kết lịch khách hôm nay |

## 18. Khởi Động Và Vận Hành

Script Linux:

```bash
./khoi_dong_he_thong_kpi.sh
```

Script này thực hiện:

1. Dừng các tiến trình PM2 cũ.
2. Khởi động API/Web server.
3. Khởi động bot chấm công.
4. Mở Cloudflare Tunnel tới port Mini App.
5. Lấy URL public của Cloudflare.
6. Cập nhật `MINI_APP_URL` trong `.env`.
7. Restart PM2 để bot dùng URL mới.

Các tiến trình PM2 chính:

- `kpi-api`.
- `kpi-bot`.
- `timekeep-bot`.

Lưu ý: trong mã nguồn hiện tại, `apps/bot/index.js` và `apps/bot/timekeep_bot.js` đều có server Mini App dùng port `3002` theo mặc định. Khi vận hành cần đảm bảo không chạy hai entrypoint chiếm cùng port cùng lúc, hoặc cấu hình port riêng.

## 19. Biến Môi Trường Quan Trọng

| Biến | Vai trò |
| --- | --- |
| `DATABASE_URL` | Chuỗi kết nối PostgreSQL |
| `TELEGRAM_BOT_TOKEN` | Token Telegram Bot |
| `ADMIN_IDS` | Danh sách Telegram ID có quyền admin |
| `MINI_APP_URL` | URL public cho Telegram Mini App |
| `GOOGLE_SPREADSHEET_ID` | Google Sheet báo cáo KPI/phạt |
| `CUSTOMER_SPREADSHEET_ID` | Google Sheet lịch khách hàng |
| `API_PORT` | Port API/Web Admin |
| `PORT` | Port Mini App server trong bot chấm công |

## 20. Ghi Chú Phạm Vi

- Tài liệu này phản ánh chức năng theo mã nguồn hiện tại, không chỉ theo file thiết kế ban đầu.
- Một số bảng được code sử dụng nhưng không xuất hiện đầy đủ trong `schema_timekeep.sql`; cần đảm bảo migration thực tế trên server đã tạo đủ các bảng như `tk_leave_requests`, `tk_group_settings`, `pending_reports`, `customer_appointments`, `image_fingerprints`, `telegram_workflows`, `schedule_notification_groups`.
- Web Admin hiện có đăng nhập đơn giản bằng tài khoản hard-code trong API, chưa phải cơ chế JWT đầy đủ theo tài liệu thiết kế ban đầu.
- Một số nút trên Web Admin như nhắc nhở tự động hoặc xuất Excel đang thiên về giao diện/placeholder, cần kiểm tra thêm nếu muốn dùng như chức năng production hoàn chỉnh.
