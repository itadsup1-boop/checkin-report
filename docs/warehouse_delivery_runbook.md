# Runbook hoàn thiện và triển khai chức năng quản lý kho

Tài liệu này mô tả thứ tự phải thực hiện từ cấu trúc hiện tại đến khi chức năng đơn xuất theo khách hàng/dịch vụ được đưa lên production.

## 1. Trạng thái hiện tại (cập nhật 12/08/2026)

### Đã hoàn thành

- [x] Tách backend kho khỏi `timekeep_bot.js`.
- [x] Tách route danh mục, nhập kho và xuất kho.
- [x] Tách callback duyệt đơn lẻ và đơn nhóm.
- [x] Tách reply ảnh xác nhận.
- [x] Tách Google Sheet adapter.
- [x] Tách middleware ảnh nhập kho.
- [x] Giữ nguyên endpoint và callback cũ.
- [x] Có contract test kiểm tra đăng ký module.
- [x] Domain và repository riêng cho kho.
- [x] Transaction chống trừ âm khi nhiều người duyệt đồng thời.
- [x] Bảng dịch vụ, mẫu sản phẩm và audit.
- [x] Đơn xuất theo khách hàng có nhiều dịch vụ.
- [x] Quyền kho độc lập theo group và không tin role tự chọn.
- [x] Web Admin quản lý mẫu, sản phẩm, quyền, đơn, sổ kho và tác vụ nền.
- [x] Mini App mới tối ưu điện thoại, có draft, barcode và chống gửi trùng.
- [x] Điều chuyển dùng ngay và tab Sheet thứ 6.
- [x] Nhập tối đa 6 ảnh, nén khoảng 350 KB/ảnh và upload Drive trong nền.
- [x] Feature flag và rollback riêng theo group.
- [x] Migration V19 đã chạy lặp và được xác minh trên database local hiện tại.

### Trạng thái rollout

- Code và migration đã hoàn thành trong workspace.
- Feature flag vẫn mặc định `OFF`; dữ liệu production không tự động chuyển luồng.
- Admin phải cấu hình mẫu/quyền, kiểm tra tồn và bật lần lượt từng group theo mục 11.
- Việc đối chiếu kho vật lý/Google thật và deploy server là bước vận hành, không được giả lập bằng test local.

## 2. Nguyên tắc chạy theo giai đoạn

Không gộp nhiều giai đoạn vào một lần triển khai. Mỗi giai đoạn chỉ được chuyển sang `DONE` khi:

1. Code mới có test.
2. Test kho pass.
3. Syntax backend pass.
4. Build Web Admin pass nếu có sửa frontend.
5. Luồng timekeep, report và customer không xuất hiện lỗi hồi quy.
6. Có cách tắt feature flag hoặc quay lại process cũ mà không xóa dữ liệu.

## 3. Giai đoạn A — Xác nhận baseline sau khi tách module

### Việc cần làm

- Review danh sách route/callback trong README của module.
- Xác nhận Mini App cũ vẫn dùng đúng endpoint.
- Không thay database.
- Không bật nghiệp vụ đơn dịch vụ mới.

### Lệnh chạy

```powershell
cd C:\Users\ADMIN\Downloads\telegramReport\telegramReport
npm run test:warehouse-module
node --check apps/bot/timekeep_bot.js
npm run dev:web
```

### Kiểm tra thủ công

Trong một group test có `bot_role = warehouse`:

1. Mở danh sách tồn.
2. Tra một barcode có sẵn.
3. Nhập một sản phẩm kèm một ảnh.
4. Tạo yêu cầu xuất bằng nhân viên.
5. Duyệt bằng quản lý.
6. Reply một ảnh xác nhận.
7. Kiểm tra database, Telegram, Drive và năm tab Sheet hiện tại.

### Điều kiện đạt

- Tất cả hành vi giống trước khi tách.
- Không có route bị 404.
- Không có callback Telegram bị treo.
- Log không có lỗi import module.

## 4. Giai đoạn B — Khóa an toàn dữ liệu kho

### Code cần hoàn thành

- Tạo `warehouse repository`.
- Tạo transaction helper dùng cùng một PostgreSQL client.
- Khi duyệt phải khóa các dòng tồn bằng `SELECT ... FOR UPDATE`.
- Kiểm tra tồn và trừ tồn trong cùng transaction.
- Thêm idempotency cho thao tác duyệt.
- Thêm constraint không cho quantity âm.
- Không gọi Telegram, Drive hoặc Sheet trước khi database commit.

### Test bắt buộc

- Hai quản lý duyệt cùng một đơn.
- Một callback được Telegram gửi lại hai lần.
- Hai đơn đồng thời cùng trừ một sản phẩm.
- Lỗi giữa transaction phải rollback toàn bộ.
- Không có tồn âm.

### Điều kiện đạt

- Database luôn khớp dù integration ngoài bị lỗi.
- Một đơn chỉ được duyệt đúng một lần.

## 5. Giai đoạn C — Migration nghiệp vụ mới

### Bảng cần bổ sung

- Dịch vụ.
- Sản phẩm mẫu theo dịch vụ.
- Lịch sử thay đổi mẫu.
- Header đơn xuất khách hàng.
- Danh sách dịch vụ trong đơn.
- Chi tiết sản phẩm tách riêng theo từng dịch vụ.
- Quyền kho của nhân viên theo group.
- Điều chuyển nội bộ.
- Sổ biến động tồn kho bất biến.
- Feature flag theo group.

### Trước khi chạy migration

```powershell
git status --short
npm run test:warehouse-module
```

Sau khi file migration của giai đoạn này được viết, phải chạy thử trên bản sao database trước. Không chạy thẳng migration chưa kiểm chứng vào production.

### Đối chiếu sau migration

- Số sản phẩm không đổi.
- Tồn US và UK không đổi.
- Giao dịch cũ còn đầy đủ.
- Feature flag mặc định tắt.
- Luồng kho cũ vẫn hoạt động.

## 6. Giai đoạn D — Domain và application use case

### Command cần có

- `createImport`
- `createCustomerOrder`
- `approveCustomerOrder`
- `rejectCustomerOrder`
- `suggestInternalTransfer`
- `confirmInternalTransfer`
- `adjustInventoryByReversal`

### Query cần có

- `getInventory`
- `searchProducts`
- `getCustomerHistoryByPhone`
- `getServiceTemplates`
- `getOrderDetail`
- `getPendingOrders`

### Quy tắc domain

- Số lượng là số nguyên dương.
- Không tồn âm.
- Một đơn có ít nhất một dịch vụ.
- Sản phẩm trùng giữa hai dịch vụ vẫn là hai dòng hiển thị.
- Chỉ cộng ngầm khi kiểm tra tổng tồn.
- Quản lý/admin tạo đơn được duyệt ngay.
- Nhân viên phải chờ người có quyền kho trong group duyệt.

### Điều kiện đạt

Route và Telegram handler chỉ validate/map dữ liệu rồi gọi use case; không còn tự xử lý transaction kho.

## 7. Giai đoạn E — Web Admin

### Màn hình cần hoàn thành

- Danh sách dịch vụ.
- Tạo và sửa dịch vụ.
- Bật/tắt dịch vụ.
- Cấu hình sản phẩm và số lượng mẫu.
- Bật/tắt sản phẩm mẫu, không xóa vật lý.
- Lịch sử thay đổi mẫu.
- Cấp quyền kho theo group.
- Danh sách đơn chờ duyệt.

### Quy tắc

- Menu kho chỉ hiện khi admin có quyền.
- Quyền kho không dùng chung với quyền KPI/check-in.
- Role nhân viên tự chọn không tạo quyền duyệt.
- Web Admin gọi API riêng dưới namespace warehouse admin.

### Lệnh kiểm tra

```powershell
npm run dev:web
```

### Điều kiện đạt

- Build production pass.
- Refresh trang không mất màn hình đang mở.
- Lưu mẫu không thay đổi đơn đã tạo trước đó.

## 8. Giai đoạn F — Mini App kho trên điện thoại

### Luồng màn hình

1. Chọn cơ sở.
2. Nhập tên và số điện thoại khách.
3. Chọn một hoặc nhiều dịch vụ.
4. Hiển thị sản phẩm tách theo từng dịch vụ.
5. Cho phép sửa số lượng, bỏ dòng hoặc thêm sản phẩm đang có.
6. Hiển thị cảnh báo thiếu hàng nổi bật.
7. Xác nhận và gửi đơn.

### Yêu cầu tương thích

- Giữ URL Mini App cũ trong giai đoạn rollout.
- Có adapter hoặc redirect nếu chuyển sang build mới.
- Không đổi barcode scanner trong cùng lần triển khai đơn dịch vụ.
- Chống bấm gửi hai lần.
- Có draft trên điện thoại khi người dùng thoát nhầm.

### Điều kiện đạt

- Thao tác được bằng một tay trên màn hình nhỏ.
- Không có bảng ngang bắt buộc kéo nhiều.
- Đơn nhiều dịch vụ vẫn phân biệt rõ sản phẩm.

## 9. Giai đoạn G — Sheet, Drive và thông báo

### Google Sheet

Giữ nguyên năm tab và thêm:

- `6. Điều chuyển nội bộ`.

Database là nguồn chính. Sheet chỉ nhận dữ liệu sau commit và phải chống ghi trùng.

### Google Drive

- Nhập kho bắt buộc ảnh.
- Ảnh được lưu tạm cục bộ trước.
- Upload nền có retry.
- Chỉ xóa file tạm sau khi Drive thành công hoặc khi chính sách retry kết thúc có ghi lỗi.

### Telegram

- Đơn phát sinh ở group nào chỉ thông báo tại group đó.
- Gợi ý thiếu hàng phải nổi bật.
- Khi duyệt điều chuyển, ghi rõ sản phẩm, số lượng, cơ sở gửi và cơ sở nhận.
- Không yêu cầu phân công người vận chuyển.

### Điều kiện đạt

- Lỗi Sheet/Drive không làm mất giao dịch đã commit.
- Có log đủ `order_id`, `group_id`, `branch` và trạng thái integration.

## 10. Giai đoạn H — Test hồi quy toàn hệ thống

### Kho

- Nhập kho tối đa 6 ảnh.
- Xuất kho tự duyệt và chờ duyệt.
- Không đủ hàng.
- Điều chuyển.
- Duyệt trùng.
- Sheet retry.
- Drive retry.

### Role khác

- Timekeep: đăng ký, lịch, check-in, nhắc trước 5 phút, nghỉ phép.
- Report/report_tour: đăng ký, gửi báo cáo, ảnh và cơ chế tạm dừng theo group.
- Customer/customer_record: form, upload media, reply Telegram, Drive và Sheet.

### Lệnh tối thiểu

```powershell
npm run test:warehouse-module
node --check apps/bot/timekeep_bot.js
node --check apps/api/index.js
npm run dev:web
```

Chỉ chuyển sang rollout khi toàn bộ test tự động và checklist thủ công đều pass.

## 11. Giai đoạn I — Rollout một group test

1. Backup database.
2. Ghi snapshot tồn US/UK.
3. Chọn đúng một group warehouse nội bộ.
4. Bật feature flag cho group đó.
5. Các group kho khác tiếp tục luồng cũ.
6. Theo dõi log tối thiểu một chu kỳ nhập, xuất, duyệt và điều chuyển.
7. Đối chiếu database với Sheet.

### Rollback

- Tắt feature flag của group.
- Không xóa đơn hoặc transaction đã tạo.
- Không chạy migration down phá dữ liệu.
- Luồng cũ tiếp tục đọc bảng cũ trong thời gian tương thích.

## 12. Giai đoạn J — Production

### Trước triển khai

```powershell
npm ci
npm run test:warehouse-module
node --check apps/bot/timekeep_bot.js
node --check apps/api/index.js
npm run dev:web
```

### Triển khai

- Backup database.
- Chạy migration đã được thử nghiệm.
- Build Web Admin/Mini App.
- Restart riêng service bị thay đổi.
- Không restart tunnel nếu URL không đổi.
- Bật feature flag lần lượt từng group.

### Sau triển khai

- Kiểm tra health endpoint.
- Kiểm tra PM2/Docker.
- Kiểm tra log lỗi mới.
- Tạo một đơn test có kiểm soát.
- Đối chiếu tồn database và Sheet.
- Xác nhận Telegram chỉ thông báo đúng group.

## 13. Định nghĩa hoàn thành

Chức năng chỉ được coi là hoàn thành khi:

1. `timekeep_bot.js` không còn nghiệp vụ hoặc SQL kho.
2. Quyền duyệt kho độc lập theo group.
3. Đơn khách hàng hỗ trợ nhiều dịch vụ.
4. Sản phẩm hiển thị tách riêng theo dịch vụ.
5. Duyệt và trừ tồn là transaction nguyên tử.
6. Không thể tồn âm.
7. Điều chuyển có sổ theo dõi rõ ràng.
8. Web Admin quản lý mẫu đầy đủ.
9. Mini App thao tác tốt trên điện thoại.
10. Sheet đủ sáu tab.
11. Drive upload nền có retry.
12. Feature flag và rollback hoạt động.
13. Test kho và test hồi quy role khác đều pass.
14. Tồn database, Sheet và kiểm kê thực tế khớp nhau.

## 14. Kết quả kiểm thử tự động đã thực hiện

Lệnh tổng hợp:

```powershell
npm run test:warehouse-all
npm run dev:web
$env:APP_ENV_FILE='.env'; docker compose config --quiet
```

Phạm vi đã có test:

- Validation đơn nhiều dịch vụ, số lượng nguyên và dòng bị loại.
- Chặn truy cập chéo group kho.
- Nhân viên tạo đơn chờ duyệt; quản lý/Admin tự duyệt đúng quyền.
- Web Admin duyệt và từ chối không cần bản ghi nhân viên Telegram.
- Hai lần duyệt đồng thời và idempotency không trừ kho hai lần.
- Điều chuyển dùng ngay giữa US/UK và chặn tổng tồn thiếu.
- Hoàn tác cộng trả đúng kho vật lý, tạo bút toán đảo và chạy lặp an toàn.
- Nhập ảnh commit database trước; retry không upload Drive trùng và chỉ xóa file sau khi toàn bộ tác vụ thành công.
- Google Sheet giữ đúng 6 tab, không ghi trùng và phản ánh trạng thái hoàn tác.
- Route Admin từ chối request thiếu phiên đăng nhập.
- Query Web Admin chạy trên schema PostgreSQL thật.
- Mini App có cú pháp hợp lệ, tối đa 6 ảnh, nén 350 KB, progress 0–99/100 và fallback iOS WebView.
- Hồi quy membership KPI: tạm dừng theo group và chuyển group không kích hoạt lại group cũ.
- Web Admin build production thành công và Docker Compose hợp lệ.

Các test Google Sheet/Drive/Telegram dùng adapter giả lập để không ghi dữ liệu thử vào dịch vụ thật. Khi rollout một group test vẫn phải thực hiện checklist đối chiếu thủ công tại mục 11.
