# Bảo mật Web Admin

## Triển khai lần đầu

1. Sao lưu database và chạy migration session:

   ```bash
   npm run migrate:admin-v31
   ```

2. Đặt các biến bí mật trong môi trường chạy lệnh (không ghi vào Git):

   - `ADMIN_BOOTSTRAP_USERNAME` — mặc định `admin` nếu bỏ trống.
   - `ADMIN_BOOTSTRAP_PASSWORD` — bắt buộc, tối thiểu 12 ký tự và không chứa username.
   - `ADMIN_BOOTSTRAP_FULL_NAME` — tên hiển thị tùy chọn.

3. Tạo hoặc đặt lại Super Admin:

   ```bash
   npm run bootstrap:admin
   ```

4. Khởi động lại cả API và bot. Mọi session cũ của tài khoản bootstrap sẽ bị thu hồi.

Tài khoản mặc định lịch sử `admin/admin123` bị server từ chối, kể cả khi bản ghi cũ
vẫn còn trong database.

## Cơ chế đang áp dụng

- Mật khẩu mới được băm bằng `scrypt` với salt riêng; mật khẩu plaintext cũ được
  nâng cấp sau lần đăng nhập hợp lệ.
- Token session ngẫu nhiên 256 bit; database chỉ lưu SHA-256 của token.
- Session mặc định hết hạn sau 8 giờ, cấu hình bằng `ADMIN_SESSION_HOURS` (1–24 giờ).
- Đăng xuất, đổi mật khẩu, đổi quyền hoặc khóa tài khoản sẽ thu hồi session.
- Năm lần đăng nhập sai trong 15 phút sẽ khóa tạm theo IP và username.
- Danh tính, vai trò và nhóm được phép luôn lấy từ database, không lấy từ header do
  trình duyệt tự khai.
