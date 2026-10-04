# Mini App hồ sơ khách hàng

Biểu mẫu ghi nhận một lượt khách: thông tin khách, thanh toán, ảnh/video minh chứng.
Dành cho group có `bot_role = 'customer'` hoặc `'customer_record'`.

## Điểm vào

`/mini-app/customer_form.html` → nạp `app.js`. URL giữ nguyên để nút
"☘️ Điền Thông Tin Khách Hàng" của bot và `router.html` không phải đổi.

## Cấu trúc

```text
customer/form/
├── app.js                     Điều phối: xác thực, nối 3 phần, gọi API
├── theme.css                  Layout + bảng màu tối riêng của app này
├── domain/
│   └── record-rules.js        Quy tắc thuần: quy đổi tiền, tính nợ, kiểm SĐT
├── data/
│   └── customer-repo.js       Gửi hồ sơ qua XHR (có tiến độ tải lên)
├── ui/
│   └── components.js          Thẻ, ô nhập, ảnh xem trước, lớp phủ, màn kết thúc
└── sections/
    ├── info-section.js        Tư vấn · loại khách · tên · SĐT · địa chỉ · dịch vụ · quà
    ├── money-section.js       Hóa đơn · đã trả · còn nợ · thợ · bảo hành
    └── media-section.js       Chọn chế độ nộp ảnh + tải lên + xem trước
```

Hạ tầng dùng chung ở [`../../shared-ui/`](../../shared-ui/README.md).

Hướng phụ thuộc: `sections` → `ui` / `data` → `domain` → `shared-ui/core`.

## Quy đổi tiền — chỗ dễ sai nhất

Nhân viên gõ tắt, không gõ đủ số 0. Sai một bậc là **sai doanh thu**:

| Gõ vào | Thành |
|---|---|
| `30tr` · `30 triệu` · `30m` · `30 củ` | 30 000 000 |
| `500k` · `500 nghìn` · `500 ngàn` · `500 lít` | 500 000 |
| `1.500.000` · `1,500,000` | 1 500 000 |

Bỏ dấu chấm và dấu phẩy **trước** khi lấy số: người Việt dùng dấu chấm làm phân cách
nghìn, không phải phân cách thập phân.

Ô **"Còn nợ" tự tính và bị khoá** (`= hóa đơn − đã trả`, không bao giờ âm). Để nhân
viên tự gõ thì con số sẽ lệch, mà đây là số vào doanh thu.

Payload gửi lên là **số đã quy đổi**, không phải chuỗi `"30tr"`.

## Hai chế độ nộp ảnh

| Chế độ | Cách chạy | Điều kiện |
|---|---|---|
| `mini_app` | Chọn tệp ngay trong Mini App, gửi kèm hồ sơ | **Bắt buộc ≥ 1 tệp**, tối đa 20 |
| `telegram_reply` | Gửi hồ sơ trước; bot đăng một tin trong nhóm, nhân viên quay lại reply ảnh vào tin đó | Không cần tệp lúc gửi |

Chế độ reply dùng khi tệp nặng hoặc mạng yếu — Telegram tải khoẻ hơn Mini App.
Máy chủ trả về `media_mode` để màn hình kết thúc nói đúng việc còn phải làm.

## Nguyên tắc khi sửa

1. **Không dựng HTML từ dữ liệu người dùng.** Tên khách, địa chỉ, dịch vụ đều do
   người gõ — dùng `h()` trong `../../shared-ui/core/dom.js`.
2. **Giữ XHR cho việc gửi**, đừng đổi sang `fetch`: hồ sơ kèm tới 20 tệp, mất tiến độ
   tải lên là nhân viên tưởng treo rồi bấm gửi lại → hồ sơ trùng.
3. **Số tiền luôn qua `parseMoney()`** trước khi gửi. Đừng gửi chuỗi thô.
4. **Bảng màu tối là cố ý.** Đây là app duy nhất còn nền tối; kho và lịch khách đã
   sang bảng sáng dùng chung. Muốn gộp thì ánh xạ khối `:root` trong `theme.css` sang
   `../../shared-ui/theme-tokens.css`, giống cách `warehouse/` đã làm.

## Test

```powershell
npm run test:customer-miniapp
```
