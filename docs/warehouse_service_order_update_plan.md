# Kế hoạch cập nhật xuất kho theo khách hàng và mẫu dịch vụ

## Thông tin tài liệu

- Ngày lập ban đầu: 12/08/2026
- Ngày cập nhật nghiệp vụ: 12/08/2026
- Phiên bản tài liệu: 3.0
- Trạng thái: Đã triển khai và kiểm thử trong workspace; feature flag production vẫn tắt
- Phạm vi: Web Admin, Mini App xuất kho, nhập kho, điều chuyển nội bộ, database, Google Sheet và Google Drive
- Đối tượng sử dụng: Nhân viên, quản lý kho, quản lý cơ sở, Admin và kế toán

## 1. Mục tiêu của đợt cập nhật

Đợt cập nhật nhằm giúp nhân viên tạo đơn xuất kho nhanh trên điện thoại cho từng khách hàng dựa trên các mẫu sản phẩm đã được Admin thiết lập theo dịch vụ.

Các mục tiêu chính:

1. Mỗi lần khách đến làm dịch vụ là một đơn riêng.
2. Một đơn có thể chứa nhiều dịch vụ.
3. Nhân viên không phải tìm lại toàn bộ sản phẩm cho mỗi khách.
4. Admin có Web quản lý dịch vụ và danh sách sản phẩm mẫu.
5. Nhân viên được tùy chỉnh sản phẩm trong từng đơn mà không làm thay đổi mẫu gốc.
6. Đơn của nhân viên phải được người có quyền duyệt.
7. Đơn do quản lý hoặc Admin tạo được tự động chấp nhận.
8. Khi đơn được duyệt, sản phẩm được trừ kho ngay.
9. Tuyệt đối không cho phép tồn kho âm.
10. Nếu cơ sở thực hiện thiếu hàng, hệ thống đề xuất lấy từ cơ sở còn lại và làm nổi bật cảnh báo cho người duyệt.
11. Điều chuyển nội bộ phải được ghi riêng để kế toán truy ra luồng hàng.
12. Google Sheet vẫn giữ cấu trúc quen thuộc và bổ sung một tab điều chuyển nội bộ.
13. Giao diện Mini App phải phù hợp với màn hình điện thoại và thao tác một tay.

## 2. Các khái niệm được thống nhất

### 2.1. Cơ sở

- `US` trong dữ liệu hiện tại chính là cơ sở `MEDITECH`.
- `UK` là cơ sở UK.
- Tên tab Google Sheet hiện tại vẫn giữ chữ `US` theo yêu cầu, không đổi tên tab.

### 2.2. Đơn xuất kho theo khách

Một khách trong một lần đến làm dịch vụ là một đơn riêng.

Nếu cùng một lần khách làm nhiều dịch vụ thì tất cả dịch vụ được lưu trong cùng một đơn.

Nếu khách quay lại vào lần khác thì tạo đơn mới. Hệ thống dùng số điện thoại để gợi ý lại tên khách từ lịch sử.

### 2.3. Mẫu dịch vụ

Mẫu dịch vụ là danh sách sản phẩm và số lượng mặc định do Admin thiết lập trên Web Admin.

Mẫu dùng chung cho cả MEDITECH và UK.

Khi tạo đơn, hệ thống sao chép mẫu vào đơn. Mọi chỉnh sửa sau đó chỉ tác động đến đơn hiện tại.

### 2.4. Nhập kho

Nhập kho là nhập sản phẩm mới vào một cơ sở. Đây là nghiệp vụ duy nhất bắt buộc phải có ảnh minh chứng trong phạm vi đợt cập nhật này.

### 2.5. Xuất kho

Xuất kho trong hệ thống mới chính là xuất sản phẩm để sử dụng cho một khách hàng cụ thể.

## 3. Phạm vi áp dụng

Chức năng áp dụng cho mọi nhóm Telegram được Admin đặt role liên quan đến quản lý kho.

Nhóm Telegram không bị cố định vào MEDITECH hoặc UK. Người thao tác phải chọn cơ sở khi nhập hoặc xuất hàng.

Mỗi giao dịch phải lưu đồng thời:

- Nhóm Telegram phát sinh giao dịch.
- Cơ sở được người dùng chọn.
- Người thao tác.
- Ngày giờ thao tác.
- Loại giao dịch.
- Các sản phẩm và số lượng.

Thông báo của một đơn chỉ được gửi vào chính nhóm Telegram nơi đơn đó được tạo. Không tự động gửi sang nhóm kho khác.

## 4. Vai trò và phân quyền

### 4.1. Nhân viên

Nhân viên được phép:

- Tạo đơn xuất kho theo khách hàng.
- Nhập tên và số điện thoại khách.
- Chọn cơ sở thực hiện.
- Chọn một hoặc nhiều dịch vụ.
- Sửa số lượng sản phẩm trong đơn.
- Loại sản phẩm không dùng khỏi đơn.
- Thêm sản phẩm khác đang tồn tại trong danh mục kho.
- Gửi đơn chờ duyệt.

Nhân viên không được phép:

- Tự tạo sản phẩm kho mới trong luồng xuất kho.
- Sửa mẫu dịch vụ của Admin.
- Tự có quyền duyệt chỉ vì chọn chức danh quản lý khi đăng ký.
- Duyệt đơn nếu chưa được Admin cấp quyền trên Web.

### 4.2. Quản lý kho hoặc quản lý cơ sở

Tài khoản chỉ được coi là có quyền quản lý khi đã được Admin duyệt/cấp quyền trên Web Admin.

Người có quyền quản lý được phép:

- Duyệt hoặc từ chối đơn do nhân viên tạo.
- Xem cảnh báo thiếu hàng.
- Xác nhận đề xuất lấy hàng từ cơ sở còn lại.
- Tạo đơn cho khách.
- Đơn do chính quản lý tạo được tự động chấp nhận, không cần người khác duyệt.

### 4.3. Admin

Admin được phép:

- Cấp hoặc thu hồi quyền quản lý trên Web.
- Quản lý danh mục dịch vụ.
- Quản lý mẫu sản phẩm của từng dịch vụ.
- Bật/tắt dịch vụ.
- Bật/tắt sản phẩm trong mẫu dịch vụ.
- Xem lịch sử chỉnh sửa mẫu.
- Duyệt mọi đơn xuất kho.
- Tạo đơn và được tự động chấp nhận.
- Thực hiện nghiệp vụ sửa sai có lưu lịch sử.
- Xem toàn bộ báo cáo nhập, xuất, tồn và điều chuyển.

### 4.4. Kế toán

Kế toán chỉ cần theo dõi số lượng, không theo dõi giá vốn trong đợt này.

Kế toán cần xem được:

- Tồn đầu kỳ.
- Sản phẩm nhập vào.
- Sản phẩm xuất dùng cho khách.
- Sản phẩm chuyển giữa MEDITECH và UK.
- Thời gian phát sinh.
- Người tạo và người duyệt.
- Tồn cuối kỳ.
- Các giao dịch điều chỉnh nếu có.

## 5. Phân quyền quản lý trên Web Admin

Chức danh do người dùng chọn khi đăng ký chỉ là thông tin hiển thị. Chức danh đó không tự tạo quyền phê duyệt.

Web Admin cần có quyền riêng tối thiểu:

- `Duyệt xuất kho`.
- `Tự duyệt đơn do mình tạo`.
- `Duyệt điều chuyển nội bộ`.
- `Quản lý mẫu dịch vụ`.
- `Quản lý sản phẩm`.
- `Sửa sai giao dịch kho`.
- `Xem báo cáo kho`.

Admin bật hoặc tắt từng quyền cho tài khoản.

Quy tắc bắt buộc:

- Người chưa được cấp quyền quản lý luôn được xử lý như nhân viên thường.
- Không dựa riêng vào chuỗi role do người dùng tự chọn để cho phép duyệt đơn.
- Mọi lần cấp và thu hồi quyền phải có lịch sử người thực hiện và thời gian.

## 6. Danh mục sản phẩm

Sản phẩm mới được tạo trong luồng nhập kho hoặc màn hình quản lý sản phẩm dành cho Admin, không được tạo trong luồng xuất kho.

Thông tin sản phẩm tối thiểu:

- Mã sản phẩm.
- Mã vạch.
- Tên sản phẩm.
- Đơn vị tính.
- Trạng thái đang sử dụng hoặc tạm ngừng.
- Tồn MEDITECH/US.
- Tồn UK.

Quy tắc:

- Số lượng trong đợt đầu chỉ dùng số nguyên.
- Không quản lý số lô.
- Không quản lý hạn sử dụng.
- Không quản lý giá nhập, giá xuất hoặc giá vốn.
- Sản phẩm đã có lịch sử giao dịch không được xóa vật lý.
- Admin chỉ tắt sản phẩm để sản phẩm không xuất hiện trong thao tác mới.
- Lịch sử nhập/xuất cũ luôn được giữ nguyên.
- Xuất kho chỉ được chọn những sản phẩm đã tồn tại trong danh mục.

## 7. Web Admin quản lý dịch vụ và mẫu sản phẩm

Đây là chức năng bắt buộc của đợt cập nhật.

Admin phải quản lý mẫu dịch vụ bằng giao diện Web, không cấu hình trực tiếp trong database hoặc Google Sheet.

### 7.1. Màn hình danh sách dịch vụ

Web Admin cần có một mục riêng, ví dụ `Mẫu dịch vụ`.

Danh sách dịch vụ hiển thị:

- Mã dịch vụ.
- Tên dịch vụ.
- Số sản phẩm đang hiển thị trong mẫu.
- Trạng thái hoạt động/tạm ẩn.
- Thời gian cập nhật gần nhất.
- Admin cập nhật gần nhất.
- Nút sửa thông tin.
- Nút quản lý sản phẩm mẫu.
- Nút bật/tắt dịch vụ.

Admin được phép:

- Thêm dịch vụ mới.
- Sửa tên dịch vụ.
- Bật hoặc tắt dịch vụ.
- Tìm kiếm dịch vụ.
- Sắp xếp thứ tự dịch vụ hiển thị trên Mini App.
- Mở màn hình thiết lập sản phẩm của dịch vụ.

Dịch vụ không được xóa vật lý. Khi không dùng nữa, Admin chuyển sang trạng thái tạm ẩn.

### 7.2. Màn hình sửa mẫu của một dịch vụ

Khi mở một dịch vụ, Admin nhìn thấy danh sách sản phẩm mẫu:

| Sản phẩm | Số lượng mặc định | Trạng thái | Thứ tự |
|---|---:|---|---:|
| Kim Cannula | 2 | Hiển thị | 1 |
| Găng tay | 1 | Hiển thị | 2 |
| Gạc y tế | 5 | Tạm ẩn | 3 |

Admin được phép:

- Tìm kiếm sản phẩm đã có trong danh mục kho.
- Thêm sản phẩm vào mẫu dịch vụ.
- Nhập số lượng mặc định bằng số nguyên dương.
- Sửa số lượng mặc định.
- Sắp xếp thứ tự sản phẩm.
- Tạm ẩn một sản phẩm khỏi mẫu.
- Kích hoạt lại sản phẩm đã tạm ẩn.
- Xem trước giao diện nhân viên sẽ thấy trên điện thoại.
- Lưu thay đổi.

Admin không được phép:

- Tạo sản phẩm kho mới ngay tại màn hình mẫu dịch vụ.
- Xóa vật lý sản phẩm khỏi lịch sử mẫu.
- Thêm trùng cùng một sản phẩm hai lần trong cùng một dịch vụ.
- Nhập số lượng thập phân hoặc số lượng âm.

### 7.3. Hiệu lực của thay đổi mẫu

- Sau khi Admin lưu, đơn mới dùng mẫu mới.
- Đơn đã gửi hoặc đã duyệt giữ nguyên dữ liệu tại thời điểm tạo.
- Thay đổi mẫu không được cập nhật ngược vào đơn cũ.
- Mẫu mới áp dụng giống nhau cho MEDITECH và UK.
- Không cần Admin nhập lý do khi thay đổi mẫu.

### 7.4. Nhật ký thay đổi mẫu

Hệ thống tự lưu:

- Admin thực hiện.
- Thời gian thực hiện.
- Dịch vụ được sửa.
- Sản phẩm được thêm.
- Sản phẩm được bật hoặc tắt.
- Số lượng trước và sau.
- Thứ tự trước và sau nếu có thay đổi.

### 7.5. Xem trước giao diện điện thoại

Web Admin nên có chế độ xem trước kích thước điện thoại để Admin biết:

- Tên dịch vụ hiển thị thế nào.
- Danh sách sản phẩm có quá dài hay không.
- Thứ tự sản phẩm đã hợp lý chưa.
- Số lượng mặc định có đúng không.

## 8. Quy tắc mẫu dịch vụ trong đơn khách hàng

Khi nhân viên chọn dịch vụ, hệ thống sao chép sản phẩm mẫu vào đơn.

Nhân viên được phép:

- Tăng hoặc giảm số lượng.
- Loại sản phẩm khỏi dịch vụ trong đơn hiện tại.
- Thêm sản phẩm khác đang tồn tại trong kho.
- Quét mã vạch để thêm sản phẩm đã tồn tại.

Không yêu cầu nhân viên nhập lý do khi:

- Sửa số lượng.
- Loại sản phẩm.
- Thêm sản phẩm ngoài mẫu.

Hệ thống vẫn tự lưu số lượng mẫu ban đầu và số lượng cuối cùng để phục vụ thống kê.

Mọi tùy chỉnh chỉ áp dụng cho đơn hiện tại. Mẫu dịch vụ trên Web Admin không thay đổi.

## 9. Một khách có nhiều dịch vụ

Một đơn có thể chứa nhiều dịch vụ.

Nếu hai dịch vụ có cùng một sản phẩm thì không gộp thành một dòng trên giao diện.

Ví dụ:

```text
Dịch vụ: Căng da
- Găng tay: 2
- Kim Cannula: 1

Dịch vụ: Filler
- Găng tay: 1
- Kim tiêm: 2
```

Nhân viên phải nhìn thấy riêng từng dịch vụ để biết bộ sản phẩm của mỗi dịch vụ đã đủ hay chưa.

Phía hệ thống vẫn cộng tổng ngầm theo mã sản phẩm để kiểm tra tồn kho:

```text
Tổng cần kiểm tra tồn:
- Găng tay: 3
- Kim Cannula: 1
- Kim tiêm: 2
```

Quy tắc bắt buộc:

- Không gộp trên Mini App.
- Không gộp mất nguồn dịch vụ trong database.
- Tab Xuất kho có thể có nhiều dòng cùng sản phẩm nếu thuộc các dịch vụ khác nhau.
- Chỉ cộng tổng nội bộ để kiểm tra và trừ kho chính xác.

## 10. Thông tin bắt buộc của đơn

Mỗi đơn phải có:

- Mã đơn tự sinh.
- Ngày giờ tạo.
- Nhóm Telegram tạo đơn.
- Nhân viên tạo đơn.
- Tên khách hàng.
- Số điện thoại khách hàng.
- Cơ sở thực hiện: `US/MEDITECH` hoặc `UK`.
- Ít nhất một dịch vụ.
- Danh sách sản phẩm theo từng dịch vụ.
- Trạng thái đơn.
- Người duyệt nếu đơn cần duyệt.
- Thời gian duyệt.
- Thông tin điều chuyển nếu có.

Tên khách, số điện thoại, cơ sở và ít nhất một dịch vụ là bắt buộc.

Số điện thoại được phép hiển thị đầy đủ trong nhóm Telegram theo quyết định nghiệp vụ hiện tại.

Nếu số điện thoại đã có trong lịch sử:

- Tạo đơn mới.
- Gợi ý lại tên khách cũ.
- Nhân viên vẫn được sửa tên trước khi gửi.

Không cần lưu bác sĩ, tư vấn viên hoặc người thực hiện dịch vụ trong phạm vi hiện tại.

## 11. Luồng Mini App tối ưu cho điện thoại

Mini App sử dụng luồng từng bước:

```text
Thông tin khách và cơ sở
          ↓
Chọn một hoặc nhiều dịch vụ
          ↓
Kiểm tra sản phẩm theo từng dịch vụ
          ↓
Kiểm tra tồn và cảnh báo thiếu hàng
          ↓
Xác nhận và gửi đơn
```

### 11.1. Bước thông tin khách

Hiển thị:

- Tên khách.
- Số điện thoại.
- Cơ sở thực hiện.
- Nút tiếp tục.

Yêu cầu giao diện:

- Mở bàn phím số cho điện thoại.
- Tự gợi ý tên khách theo lịch sử.
- Cơ sở phải được chọn rõ ràng cho từng giao dịch.
- Không tự suy luận cơ sở từ tên nhóm Telegram.
- Trước khi gửi phải làm nổi bật cơ sở đã chọn để tránh chọn nhầm.

Ví dụ:

> CƠ SỞ XUẤT: UK

### 11.2. Bước chọn dịch vụ

- Cho chọn nhiều dịch vụ.
- Có ô tìm kiếm.
- Dịch vụ hiển thị dạng thẻ hoặc nút lớn.
- Không dùng dropdown nhỏ khó thao tác.
- Chỉ hiển thị dịch vụ đang hoạt động.

### 11.3. Bước kiểm tra sản phẩm

Sản phẩm được chia theo từng khối dịch vụ.

Mỗi sản phẩm có:

- Tên sản phẩm.
- Số lượng mặc định.
- Nút tăng/giảm.
- Ô nhập số lượng nguyên.
- Nút loại khỏi đơn.
- Tồn US/MEDITECH.
- Tồn UK.

Có nút:

- `Thêm sản phẩm`.
- `Quét mã vạch`.
- `Khôi phục sản phẩm vừa loại` nếu cần.

### 11.4. Bước cảnh báo thiếu hàng

Nếu cơ sở được chọn không đủ nhưng cơ sở kia còn hàng, cảnh báo phải nằm ở vị trí nổi bật:

> 🚨 UK ĐANG THIẾU HÀNG  
> Kim Cannula: cần 5, UK chỉ còn 3.  
> MEDITECH còn 10, đề xuất lấy 2 từ MEDITECH sang UK.

Nhân viên không được tự quyết định điều chuyển.

Người có quyền quản lý/Admin sẽ quyết định khi duyệt.

Nếu tổng tồn của hai cơ sở không đủ:

> ❌ TOÀN HỆ THỐNG KHÔNG ĐỦ HÀNG  
> Cần 5, tổng MEDITECH và UK chỉ còn 4.

Trong trường hợp này không cho gửi duyệt thành công hoặc không cho người quản lý duyệt, tùy thời điểm phát hiện.

### 11.5. Bước xác nhận

Hiển thị:

- Tên và số điện thoại khách.
- Cơ sở thực hiện.
- Các dịch vụ.
- Sản phẩm theo từng dịch vụ.
- Tổng số lượng dùng để kiểm tra tồn.
- Các sản phẩm cần lấy từ cơ sở còn lại.
- Nút gửi đơn cố định phía dưới màn hình.

### 11.6. Tiêu chuẩn giao diện

- Không dùng bảng ngang.
- Không yêu cầu kéo trái/phải.
- Vùng bấm tối thiểu khoảng 44–48 px.
- Nút hành động chính cố định phía dưới.
- Có thể quay lại bước trước mà không mất dữ liệu.
- Tự lưu nháp khi đóng Mini App.
- Chống gửi trùng khi người dùng bấm nhiều lần.
- Mục tiêu thao tác một đơn thông thường khoảng 30–60 giây sau khi quen.

## 12. Trạng thái và phê duyệt đơn

Trạng thái tối thiểu:

| Trạng thái | Ý nghĩa |
|---|---|
| `DRAFT` | Nhân viên đang nhập, chưa gửi |
| `PENDING_APPROVAL` | Đơn nhân viên đã gửi, đang chờ duyệt |
| `APPROVED` | Đã duyệt và đã trừ kho |
| `REJECTED` | Bị từ chối, không trừ kho |

Không có bước giữ chỗ và không có bước xác nhận bàn giao riêng.

### 12.1. Đơn do nhân viên tạo

1. Nhân viên gửi đơn.
2. Hệ thống kiểm tra tồn để hiển thị tình trạng.
3. Đơn chuyển sang `PENDING_APPROVAL`.
4. Quản lý/Admin mở đơn và xem cảnh báo thiếu hàng.
5. Khi duyệt, hệ thống kiểm tra tồn lần cuối.
6. Nếu đủ, trừ kho ngay và chuyển thành `APPROVED`.
7. Nếu không đủ, từ chối thao tác duyệt và hiển thị mặt hàng thiếu.

Người order chính là người nhận sản phẩm và bàn giao cho khách.

### 12.2. Đơn do quản lý hoặc Admin tạo

1. Người có quyền tạo đơn.
2. Hệ thống kiểm tra tồn.
3. Nếu đủ, đơn tự động được chấp nhận.
4. Tồn kho được trừ ngay.
5. Không cần người thứ hai duyệt.

### 12.3. Xử lý đồng thời

Kiểm tra tồn, ghi duyệt, ghi điều chuyển và trừ kho phải nằm trong cùng một transaction database.

Nếu bất kỳ bước nào lỗi thì toàn bộ thao tác phải rollback.

Điều này đảm bảo:

- Không trừ kho hai lần.
- Không duyệt cùng một đơn hai lần.
- Không phát sinh tồn âm.
- Không ghi Sheet thành công trong khi database thất bại.

## 13. Điều chuyển nội bộ khi cơ sở thiếu hàng

### 13.1. Nguyên tắc

- Hệ thống chỉ đề xuất nguồn lấy bù.
- Nhân viên không tự quyết hoàn toàn.
- Quản lý/Admin xác nhận đề xuất trong lúc duyệt.
- Không cần xác nhận từ hai phía.
- Không cần chọn hoặc lưu người mang hàng.
- Không có trạng thái đang vận chuyển.
- Không cần ảnh minh chứng điều chuyển.
- Thông báo chỉ gửi vào nhóm nơi tạo đơn.

### 13.2. Ví dụ

Khách tại UK cần 5 Kim Cannula:

- UK có 3.
- MEDITECH có 10.
- Hệ thống đề xuất lấy 2 từ MEDITECH.

Khi quản lý duyệt, hệ thống ghi đồng thời:

1. MEDITECH chuyển kho ra: `-2`.
2. UK nhận điều chuyển: `+2` trên sổ luồng hàng.
3. UK xuất dùng cho khách: `-5`.

Kết quả tồn:

| Cơ sở | Trước | Sau |
|---|---:|---:|
| UK | 3 | 0 |
| MEDITECH | 10 | 8 |
| Tổng hệ thống | 13 | 8 |

Hai sản phẩm chuyển sang UK được dùng ngay cho khách nên không trở thành tồn khả dụng của UK.

### 13.3. Thông báo Telegram

Thông báo chỉ xuất hiện tại nhóm tạo đề nghị:

> 🚚 YÊU CẦU ĐIỀU CHUYỂN NỘI BỘ  
> Từ: MEDITECH  
> Đến: UK  
> Kim Cannula: 2  
> Găng tay: 3  
> Phục vụ đơn: ORD-001  
> Khách hàng: Nguyễn Thị A

Không gửi sang nhóm Telegram của cơ sở còn lại.

### 13.4. Dữ liệu điều chuyển phải lưu

- Mã điều chuyển.
- Mã đơn khách liên quan.
- Nhóm Telegram tạo đơn.
- Cơ sở gửi.
- Cơ sở nhận.
- Sản phẩm.
- Số lượng.
- Người tạo đơn.
- Người duyệt.
- Ngày giờ duyệt.
- Trạng thái `Đã thông báo điều chuyển`.

Không lưu:

- Người mang hàng.
- Xác nhận kho gửi.
- Xác nhận kho nhận.
- Thời gian đang vận chuyển.

## 14. Quy tắc tồn kho

### 14.1. Không cho tồn âm

Đây là quy tắc tuyệt đối.

- Không nhân viên nào được xuất vượt tồn.
- Quản lý và Admin cũng không được xuất vượt tồn.
- Không có cơ chế bật ngoại lệ tồn âm.
- Nếu một cơ sở thiếu, kiểm tra cơ sở còn lại.
- Nếu tổng cả hai cơ sở không đủ, báo thiếu hàng và không cho duyệt.

### 14.2. Kiểm tra tổng ngầm

Sản phẩm vẫn hiển thị riêng theo từng dịch vụ nhưng hệ thống phải cộng tổng theo mã sản phẩm trước khi trừ kho.

Ví dụ Găng tay xuất hiện ở hai dịch vụ với số lượng 2 và 1 thì database phải kiểm tra tổng 3.

### 14.3. Duyệt là trừ tồn

- Không giữ chỗ.
- Không chờ xác nhận bàn giao.
- Đơn được duyệt là đơn đã phát sinh xuất kho.
- Người order chịu trách nhiệm bàn giao cho khách.

### 14.4. Sửa sai

Khách đã thanh toán nên không xây luồng hủy đơn thông thường trong giai đoạn đầu.

Tuy nhiên vẫn phải có nghiệp vụ sửa sai dành cho Admin trong trường hợp:

- Chọn sai cơ sở.
- Chọn sai sản phẩm.
- Nhập sai số lượng.
- Duyệt nhầm đơn.

Không sửa hoặc xóa trực tiếp giao dịch cũ. Hệ thống tạo giao dịch đảo/điều chỉnh mới và lưu lịch sử.

## 15. Nhập kho

### 15.1. Thông tin nhập kho

- Cơ sở nhận: US/MEDITECH hoặc UK.
- Người nhập.
- Ngày giờ.
- Sản phẩm.
- Số lượng nguyên.
- Ảnh minh chứng.
- Nhóm Telegram phát sinh giao dịch.

### 15.2. Quy tắc

- Nhập kho bắt buộc có ít nhất một ảnh.
- Người dùng phải chọn cơ sở mỗi lần nhập.
- Có thể tạo sản phẩm mới trong luồng nhập theo quyền hiện có.
- Sản phẩm nhập mới sau đó mới có thể được chọn trong mẫu dịch vụ hoặc đơn xuất.
- Đồng bộ Google Drive chạy nền sau khi database ghi nhận thành công.
- Chỉ xóa tệp tạm sau khi upload Drive thành công và lưu được link.

## 16. Sổ biến động kho trong database

Database là nguồn dữ liệu chính.

Google Sheet chỉ là báo cáo đọc và đối chiếu, không phải nơi quyết định tồn kho.

Mỗi biến động phải có:

- Mã giao dịch.
- Mã đơn hoặc mã điều chuyển liên quan.
- Loại giao dịch.
- Cơ sở.
- Sản phẩm.
- Số lượng tăng hoặc giảm.
- Tồn trước giao dịch.
- Tồn sau giao dịch.
- Người tạo.
- Người duyệt.
- Nhóm Telegram nguồn.
- Ngày giờ.
- Link minh chứng nếu có.

Các loại giao dịch cần phân biệt:

- `Nhập sản phẩm`.
- `Xuất dùng cho khách`.
- `Điều chuyển ra`.
- `Điều chuyển vào và dùng ngay`.
- `Điều chỉnh tăng`.
- `Điều chỉnh giảm`.
- `Đảo giao dịch do nhập sai`.

Không cho sửa hoặc xóa vật lý dòng sổ đã hoàn thành.

## 17. Google Sheet dùng chung

Toàn hệ thống dùng chung một Google Sheet quản lý kho.

Giữ nguyên 5 tab hiện tại và thêm đúng 1 tab mới:

1. `1. Xuất kho`
2. `2. Nhập kho`
3. `3. Tồn kho US`
4. `4. Tồn kho UK`
5. `5. Tổng kho`
6. `6. Điều chuyển nội bộ`

Không thay tên các tab cũ.

### 17.1. Tab `1. Xuất kho`

Chức năng của tab này là báo cáo xuất dùng theo khách hàng.

Các cột đề xuất:

- Mã đơn.
- Ngày giờ duyệt.
- Nhóm Telegram phát sinh.
- Cơ sở thực hiện.
- Tên khách.
- Số điện thoại.
- Nhân viên tạo đơn.
- Người duyệt.
- Dịch vụ.
- Mã sản phẩm.
- Tên sản phẩm.
- Số lượng mẫu.
- Số lượng thực tế.
- Nguồn xuất: cơ sở thực hiện hoặc điều chuyển.
- Mã điều chuyển nếu có.

Nếu cùng một sản phẩm thuộc hai dịch vụ thì ghi thành hai dòng riêng để kế toán nhìn ra sản phẩm phục vụ dịch vụ nào.

### 17.2. Tab `2. Nhập kho`

Chức năng của tab này tương đương nhập sản phẩm.

Các cột đề xuất:

- Mã phiếu nhập.
- Ngày giờ.
- Nhóm Telegram phát sinh.
- Cơ sở nhập.
- Người nhập.
- Mã sản phẩm.
- Tên sản phẩm.
- Số lượng.
- Link ảnh minh chứng.

### 17.3. Tab `3. Tồn kho US`

- Giữ nguyên tên `US` dù nghiệp vụ hiểu là MEDITECH.
- Mã sản phẩm.
- Tên sản phẩm.
- Số lượng tồn hiện tại.
- Thời gian cập nhật cuối.

### 17.4. Tab `4. Tồn kho UK`

- Mã sản phẩm.
- Tên sản phẩm.
- Số lượng tồn hiện tại.
- Thời gian cập nhật cuối.

### 17.5. Tab `5. Tổng kho`

- Mã sản phẩm.
- Tên sản phẩm.
- Tồn US/MEDITECH.
- Tồn UK.
- Tổng tồn.
- Thời gian cập nhật cuối.

### 17.6. Tab `6. Điều chuyển nội bộ`

Các cột đề xuất:

- Mã điều chuyển.
- Ngày giờ duyệt.
- Nhóm Telegram tạo đề nghị.
- Cơ sở gửi.
- Cơ sở nhận.
- Mã đơn khách liên quan.
- Tên khách.
- Số điện thoại.
- Mã sản phẩm.
- Tên sản phẩm.
- Số lượng.
- Người tạo đơn.
- Người duyệt.
- Trạng thái `Đã thông báo điều chuyển`.

Không có cột người mang hàng hoặc xác nhận hai phía.

## 18. Google Drive

Google Drive dùng để lưu ảnh minh chứng nhập kho.

Cấu trúc đề xuất:

```text
Ảnh nhập kho/
└── 2026/
    └── 08-Tháng 08/
        ├── US/
        │   └── NHAP-20260812-001/
        └── UK/
            └── NHAP-20260812-002/
```

Tên thư mục cần có mã phiếu nhập để tra ngược từ database và Google Sheet.

Quy tắc:

- Lưu file tạm trên máy chủ trước.
- Ghi phiếu nhập vào database.
- Upload Drive trong nền.
- Lưu link Drive vào database.
- Đồng bộ link vào tab Nhập kho.
- Chỉ xóa file tạm sau khi upload thành công.
- Nếu Drive lỗi, giữ file và tự thử lại.

## 19. Tin nhắn Telegram

### 19.1. Đơn nhân viên chờ duyệt

Tin nhắn cần hiển thị:

- Mã đơn.
- Nhân viên tạo.
- Tên và số điện thoại khách.
- Cơ sở thực hiện.
- Các dịch vụ.
- Danh sách sản phẩm theo từng dịch vụ.
- Các mặt hàng thiếu.
- Đề xuất lấy bù từ cơ sở còn lại.
- Nút duyệt và từ chối cho người có quyền.

### 19.2. Đơn được duyệt

Thông báo cần nêu:

- Đơn đã được chấp nhận.
- Sản phẩm đã được trừ kho.
- Cơ sở xuất.
- Người order chịu trách nhiệm bàn giao cho khách.
- Thông tin điều chuyển nếu có.

### 19.3. Phạm vi gửi thông báo

- Đơn được tạo ở nhóm nào thì chỉ nhóm đó nhận thông báo.
- Không tự động phát sang nhóm khác.
- Điều chuyển từ MEDITECH sang UK cũng chỉ thông báo trong nhóm tạo đơn.

## 20. Chống sai lệch và giao dịch trùng

### 20.1. Khóa chống gửi trùng

- Mỗi lần gửi có mã chống trùng.
- Bấm gửi nhiều lần không tạo nhiều đơn.
- Callback Telegram được gửi lại không duyệt đơn lần thứ hai.

### 20.2. Khóa tồn kho khi duyệt

Trong thời gian xử lý duyệt:

- Khóa các dòng tồn liên quan.
- Kiểm tra lại tổng số lượng cần xuất.
- Kiểm tra nguồn điều chuyển.
- Trừ kho.
- Ghi sổ kho.
- Ghi trạng thái đơn.
- Commit đồng thời.

Nếu một đơn khác vừa sử dụng lượng tồn cuối cùng, đơn đang duyệt phải báo thiếu thay vì tạo tồn âm.

### 20.3. Audit log

Lưu:

- Ai tạo đơn.
- Ai sửa đơn trước khi gửi.
- Ai duyệt hoặc từ chối.
- Tài khoản có quyền gì tại thời điểm duyệt.
- Ai xác nhận điều chuyển.
- Tồn trước và sau.
- Lịch sử sửa sai.

## 21. Hiệu năng và xử lý nền

### 21.1. Việc phải hoàn thành trước khi báo thành công

- Kiểm tra quyền.
- Kiểm tra tồn.
- Trừ tồn.
- Ghi đơn.
- Ghi sổ kho.
- Ghi điều chuyển nếu có.

### 21.2. Việc chạy nền

- Đồng bộ Google Sheet.
- Upload Google Drive cho nhập kho.
- Gửi hoặc thử lại thông báo Telegram nếu cần.

### 21.3. Trạng thái đồng bộ

Mỗi chứng từ nên lưu:

- `sheet_sync_status`.
- `drive_sync_status` đối với nhập kho.
- `telegram_notify_status`.
- Số lần thử lại.
- Lỗi gần nhất.
- Thời điểm thử lại tiếp theo.

Google lỗi không được làm mất giao dịch đã ghi nhận trong database.

### 21.4. Mục tiêu hiệu năng

- Mở Mini App trên 4G ổn định trong khoảng dưới 2–3 giây sau lần tải đầu.
- Tìm dịch vụ và sản phẩm gần như tức thời sau khi danh mục đã tải.
- Gửi đơn và nhận kết quả trong khoảng dưới 2 giây khi không phải chờ dịch vụ Google.
- Không bắt nhân viên chờ Google Sheet hoặc Drive hoàn tất.

## 22. Báo cáo quản trị và kiểm kê cuối tháng

Kế toán không cần giá trị tiền, chỉ cần số lượng và luồng hàng.

Báo cáo cuối tháng phải truy ra được:

- Tồn đầu tháng tại US/MEDITECH.
- Tồn đầu tháng tại UK.
- Tổng nhập kho từng cơ sở.
- Tổng xuất dùng theo khách từng cơ sở.
- Tổng chuyển từ US/MEDITECH sang UK.
- Tổng chuyển từ UK sang US/MEDITECH.
- Tổng điều chỉnh tăng/giảm.
- Tồn cuối tháng từng cơ sở.
- Tổng tồn toàn hệ thống.
- Người tạo và người duyệt từng giao dịch.
- Thời điểm từng giao dịch.
- Đơn khách liên quan đến mỗi lần xuất.

Công thức kiểm kê:

```text
Tồn cuối cơ sở
= Tồn đầu
+ Nhập sản phẩm
+ Điều chuyển vào
- Điều chuyển ra
- Xuất dùng cho khách
± Điều chỉnh
```

Đối với hàng chuyển sang để dùng ngay cho khách, tab điều chuyển vẫn ghi luồng vào/ra nhưng số hàng đó không nằm lại trong tồn khả dụng của cơ sở nhận.

## 23. Các trường hợp cần xử lý

- Một khách có nhiều dịch vụ.
- Hai dịch vụ có cùng sản phẩm nhưng phải hiển thị riêng.
- Nhân viên loại toàn bộ sản phẩm khỏi một dịch vụ.
- Nhân viên thêm sản phẩm đang có trong danh mục.
- Sản phẩm trong mẫu đã bị Admin tắt.
- Cơ sở thực hiện không đủ nhưng cơ sở kia đủ.
- Tổng hai cơ sở không đủ.
- Hai quản lý cùng duyệt các đơn sử dụng lượng tồn cuối cùng.
- Người dùng chọn nhầm cơ sở.
- Người dùng gửi cùng một đơn nhiều lần do mạng chậm.
- Google Sheet hoặc Drive tạm thời lỗi.
- Nhân viên đóng Mini App khi đang nhập.
- Một số điện thoại có nhiều đơn trong cùng ngày.
- Admin sửa mẫu trong lúc nhân viên đang tạo đơn.
- Giao dịch đã duyệt nhưng phát hiện nhập sai và cần tạo giao dịch đảo.

## 24. Lộ trình triển khai đề xuất

### Giai đoạn 1 – Chuẩn hóa database và sổ kho

- Chuẩn hóa loại giao dịch.
- Bổ sung đơn khách hàng và chi tiết theo dịch vụ.
- Bổ sung sổ biến động kho.
- Bổ sung điều chuyển liên kết trực tiếp với đơn.
- Bổ sung quyền quản lý do Admin cấp.
- Đảm bảo dữ liệu hiện tại không bị mất.

### Giai đoạn 2 – Web Admin mẫu dịch vụ

- Danh sách dịch vụ.
- Thêm/sửa/bật/tắt dịch vụ.
- Màn hình thiết lập sản phẩm mẫu.
- Sửa số lượng và thứ tự.
- Bật/tắt sản phẩm trong mẫu.
- Xem trước giao diện điện thoại.
- Nhật ký thay đổi.

### Giai đoạn 3 – Mini App xuất kho theo khách

- Thông tin khách và cơ sở.
- Gợi ý khách cũ theo số điện thoại.
- Chọn nhiều dịch vụ.
- Hiển thị sản phẩm riêng theo dịch vụ.
- Tùy chỉnh sản phẩm trong đơn.
- Cảnh báo thiếu hàng nổi bật.

### Giai đoạn 4 – Duyệt và trừ kho

- Đơn nhân viên chờ duyệt.
- Đơn quản lý/Admin tự động chấp nhận.
- Kiểm tra tồn và trừ kho trong transaction.
- Quyền duyệt lấy từ Web Admin.
- Chống duyệt trùng và tồn âm.

### Giai đoạn 5 – Điều chuyển nội bộ

- Đề xuất nguồn lấy bù.
- Quản lý/Admin xác nhận một lần.
- Không yêu cầu xác nhận hai phía.
- Không chọn người mang hàng.
- Gửi thông báo trong nhóm tạo đơn.
- Ghi tab Điều chuyển nội bộ.

### Giai đoạn 6 – Google Sheet và Drive

- Giữ nguyên 5 tab.
- Thêm tab thứ 6 Điều chuyển nội bộ.
- Đồng bộ Sheet trong nền.
- Lưu ảnh nhập kho lên Drive.
- Retry khi Google tạm lỗi.

### Giai đoạn 7 – Kiểm thử và triển khai

- Test tự động database và API.
- Test Mini App trên iPhone và Android.
- Test mạng 4G chậm.
- Chạy thử tại bất kỳ nhóm nào được đặt role quản lý kho.
- Đối chiếu tồn database, Sheet và tồn thực tế mỗi ngày trong thời gian chạy thử.
- Sửa lỗi rồi mới triển khai rộng.

## 25. Kế hoạch kiểm thử bắt buộc

### 25.1. Web Admin mẫu dịch vụ

- Thêm dịch vụ.
- Sửa tên dịch vụ.
- Bật/tắt dịch vụ.
- Thêm sản phẩm có sẵn vào mẫu.
- Chặn thêm trùng sản phẩm.
- Chặn số lượng âm, thập phân hoặc bằng 0.
- Tắt và bật lại sản phẩm mẫu.
- Kiểm tra mẫu dùng chung cho hai cơ sở.
- Kiểm tra đơn cũ không đổi khi sửa mẫu.
- Kiểm tra lịch sử Admin chỉnh sửa.

### 25.2. Tùy chỉnh đơn

- Loại sản phẩm khỏi đơn.
- Thay đổi số lượng.
- Thêm sản phẩm đang tồn tại.
- Xác nhận mẫu gốc không thay đổi.
- Xác nhận không yêu cầu nhập lý do.

### 25.3. Nhiều dịch vụ

- Chọn hai dịch vụ có sản phẩm trùng.
- Xác nhận Mini App vẫn hiển thị riêng.
- Xác nhận database vẫn lưu nguồn dịch vụ.
- Xác nhận tổng kiểm tra tồn được cộng đúng.
- Xác nhận tab Xuất kho có dòng riêng theo dịch vụ.

### 25.4. Phân quyền

- Nhân viên chọn chức danh quản lý nhưng chưa được Admin cấp quyền.
- Xác nhận người đó không thể duyệt.
- Admin cấp quyền trên Web.
- Xác nhận quyền có hiệu lực.
- Thu hồi quyền và xác nhận không còn duyệt được.
- Quản lý tạo đơn và được tự động chấp nhận.

### 25.5. Tồn kho

- Đủ hàng tại cơ sở được chọn.
- Cơ sở được chọn thiếu nhưng cơ sở kia đủ.
- Tổng hai cơ sở không đủ.
- Tồn bằng 0.
- Hai đơn cùng lấy số lượng cuối cùng.
- Xác nhận không trường hợp nào tạo tồn âm.

### 25.6. Điều chuyển

- MEDITECH chuyển sang UK để dùng ngay.
- UK chuyển sang MEDITECH để dùng ngay.
- Xác nhận tổng tồn chỉ giảm theo số dùng cho khách.
- Xác nhận không cộng hàng chuyển vào tồn khả dụng của cơ sở nhận.
- Xác nhận thông báo chỉ gửi trong nhóm tạo đơn.
- Xác nhận không có người mang hàng hoặc xác nhận hai phía.
- Xác nhận tab Điều chuyển nội bộ ghi đúng.

### 25.7. Google Sheet và Drive

- Giữ nguyên tên 5 tab cũ.
- Tạo đúng tab thứ 6.
- Database và Sheet có cùng số liệu.
- Nhập kho bắt buộc ảnh.
- Ảnh lên đúng folder Drive.
- File tạm không bị xóa khi upload thất bại.
- Retry thành công khi Google hoạt động lại.

### 25.8. Điện thoại

- iPhone và Android.
- Bàn phím không che nút tiếp tục.
- Danh sách dịch vụ dài.
- Một đơn có nhiều dịch vụ và nhiều sản phẩm.
- Đóng/mở Mini App không mất nháp.
- Gửi nhiều lần không tạo đơn trùng.

## 26. Tiêu chí nghiệm thu

Đợt cập nhật hoàn thành khi đáp ứng đầy đủ:

1. Admin quản lý được dịch vụ và mẫu sản phẩm trên Web.
2. Admin chỉ bật/tắt, không xóa vật lý dữ liệu đã có lịch sử.
3. Mẫu dùng chung cho MEDITECH và UK.
4. Một đơn có nhiều dịch vụ.
5. Sản phẩm trùng vẫn hiển thị riêng theo dịch vụ.
6. Nhân viên tùy chỉnh đơn không ảnh hưởng mẫu.
7. Tên khách, số điện thoại, cơ sở và dịch vụ là bắt buộc.
8. Khách cũ được gợi ý tên nhưng vẫn tạo đơn mới.
9. Nhân viên chỉ xuất sản phẩm đang tồn tại trong danh mục.
10. Đơn nhân viên phải chờ người có quyền duyệt.
11. Quyền quản lý do Admin cấp trên Web.
12. Quản lý/Admin tạo đơn được tự động chấp nhận.
13. Duyệt đơn trừ tồn ngay.
14. Không có bước giữ chỗ hoặc xác nhận bàn giao.
15. Không cho tồn âm trong mọi trường hợp.
16. Thiếu hàng được cảnh báo nổi bật.
17. Điều chuyển chỉ cần một quản lý/Admin xác nhận.
18. Điều chuyển không có người mang hàng và không xác nhận hai phía.
19. Thông báo chỉ gửi trong nhóm tạo đơn.
20. Hàng điều chuyển dùng ngay không bị cộng vào tồn khả dụng của cơ sở nhận.
21. Google Sheet giữ nguyên 5 tab và có thêm tab Điều chuyển nội bộ.
22. Nhập kho bắt buộc ảnh.
23. Kế toán truy được tồn đầu, nhập, xuất, điều chuyển và tồn cuối.
24. Database là nguồn dữ liệu chính.
25. Google lỗi không làm mất giao dịch đã ghi nhận.
26. Có test tự động và kiểm thử thực tế trước khi triển khai rộng.

## 27. Các quyết định nghiệp vụ đã chốt

1. `US` chính là `MEDITECH`.
2. Một lần khách làm dịch vụ là một đơn.
3. Một đơn có thể chứa nhiều dịch vụ.
4. Tên khách, số điện thoại, cơ sở và ít nhất một dịch vụ là bắt buộc.
5. Số điện thoại được hiển thị đầy đủ.
6. Khách quay lại tạo đơn mới và được gợi ý tên từ lịch sử.
7. Không cần lưu bác sĩ, tư vấn viên hoặc người thực hiện.
8. Mẫu dịch vụ dùng chung cho hai cơ sở.
9. Admin quản lý mẫu dịch vụ trên Web.
10. Sản phẩm trong mẫu được bật/tắt, không xóa vật lý.
11. Nhân viên được tùy chỉnh sản phẩm trong đơn mà không cần lý do.
12. Sản phẩm trùng giữa các dịch vụ không gộp trên giao diện.
13. Hệ thống cộng tổng ngầm để kiểm tra tồn.
14. Số lượng chỉ dùng số nguyên.
15. Không quản lý lô và hạn sử dụng.
16. Không quản lý giá vốn hoặc giá xuất kho.
17. Sản phẩm mới được tạo khi nhập hàng, không tạo trong luồng xuất.
18. Nhập sản phẩm bắt buộc có ảnh.
19. Xuất dùng và điều chuyển không bắt buộc ảnh.
20. Nhân viên tự chọn chức danh nhưng quyền quản lý do Admin cấp trên Web.
21. Người thao tác chọn cơ sở mỗi lần nhập hoặc xuất.
22. Quản lý/Admin tạo đơn được tự động chấp nhận.
23. Đơn được duyệt là trừ kho ngay.
24. Người order là người nhận hàng và bàn giao cho khách.
25. Không xây luồng hủy đơn thông thường trong giai đoạn đầu.
26. Không cho tồn âm.
27. Hệ thống đề xuất điều chuyển, quản lý/Admin xác nhận.
28. Không cần xác nhận điều chuyển từ hai phía.
29. Không phân công hoặc lưu người mang hàng.
30. Thông báo chỉ gửi trong nhóm tạo đề nghị.
31. Google Sheet dùng chung toàn hệ thống.
32. Giữ nguyên 5 tab cũ và thêm tab thứ 6 Điều chuyển nội bộ.
33. Tab Xuất kho là xuất dùng theo khách.
34. Tab Nhập kho là nhập sản phẩm.

## 28. Ngoài phạm vi đợt cập nhật

Các chức năng sau chưa thực hiện trong phạm vi hiện tại:

- Quản lý số lô.
- Quản lý hạn sử dụng.
- Giá nhập, giá xuất, giá vốn và FIFO.
- Số lượng thập phân.
- Xác nhận điều chuyển từ hai phía.
- Theo dõi người vận chuyển.
- Trạng thái hàng đang vận chuyển.
- Ảnh minh chứng xuất dùng.
- Ảnh minh chứng điều chuyển.
- Quy trình khách hủy đơn thông thường.
- Tạo sản phẩm mới trong lúc xuất kho.

## 29. Phương án cuối cùng

Phương án triển khai thống nhất:

1. Admin thiết lập dịch vụ và sản phẩm mẫu trên Web Admin.
2. Nhân viên dùng Mini App để tạo từng đơn khách hàng.
3. Một đơn có thể có nhiều dịch vụ và sản phẩm được hiển thị riêng theo dịch vụ.
4. Nhân viên được tùy chỉnh đơn mà không thay đổi mẫu.
5. Nhân viên gửi đơn chờ quản lý/Admin duyệt.
6. Quản lý/Admin tạo đơn được tự động chấp nhận.
7. Duyệt đơn đồng nghĩa trừ tồn ngay.
8. Khi cơ sở thiếu, hệ thống làm nổi bật đề xuất lấy từ cơ sở còn lại.
9. Người có quyền xác nhận một lần; không cần người mang hàng hoặc xác nhận hai phía.
10. Hệ thống ghi đầy đủ luồng điều chuyển và xuất dùng trong database.
11. Thông báo chỉ gửi trong nhóm tạo đơn.
12. Google Sheet giữ 5 tab hiện tại và bổ sung tab Điều chuyển nội bộ.
13. Database quyết định tồn kho; Sheet và Drive phục vụ báo cáo, đối chiếu và minh chứng.
14. Không có giao dịch nào được phép làm tồn kho âm.

Tài liệu này là cơ sở nghiệp vụ để tiếp tục thiết kế database, API, Web Admin, Mini App và kế hoạch kiểm thử. Việc triển khai code chỉ bắt đầu sau khi người dùng yêu cầu thực hiện.

## 30. Checklist triển khai an toàn, không ảnh hưởng role khác

Phần này là danh sách công việc kỹ thuật cần hoàn thành khi bắt đầu code. Mục tiêu là nâng cấp riêng role `warehouse` và giữ nguyên hành vi của `timekeep`, `report`, `report_tour`, `customer`, `customer_record` và các chức năng khác.

### 30.1. Nguyên tắc cô lập phạm vi

- Mọi API mới phải nằm dưới namespace `/api/warehouse/*`.
- Mọi bảng mới phải có tên thể hiện rõ phạm vi kho hoặc dịch vụ kho.
- Mọi handler Telegram mới phải kiểm tra chính xác `bot_role = 'warehouse'`.
- Mọi Web Admin API mới phải kiểm tra quyền Admin và quyền nhóm.
- Không thay đổi schema hoặc ý nghĩa các bảng KPI, chấm công, hồ sơ khách hàng và kho cũ nếu chưa có migration tương thích.
- Không dùng trường `employees.role` do người dùng tự chọn để quyết định quyền duyệt kho.
- Không thay đổi `employees.is_active`, `need_report`, membership KPI hoặc quyền chấm công khi cấp quyền kho.
- Không thay đổi API Mini App hiện có của role khác.
- Không đổi tên 5 tab Google Sheet đang có.
- Không xóa giao dịch kho cũ.
- Không sửa dữ liệu lịch sử bằng lệnh cập nhật hàng loạt không có audit.

### 30.2. Ranh giới module cần tạo

Khi triển khai nên tách nghiệp vụ kho khỏi file bot tổng để giảm nguy cơ tác động chéo.

Các module đề xuất:

- `warehouse/routes`: API Mini App dành riêng cho kho.
- `warehouse/services/order`: tạo, duyệt và từ chối đơn.
- `warehouse/services/inventory`: khóa tồn, kiểm tra tồn và trừ tồn.
- `warehouse/services/transfer`: đề xuất và ghi điều chuyển nội bộ.
- `warehouse/services/templates`: dịch vụ và sản phẩm mẫu.
- `warehouse/services/permissions`: quyền kho do Admin cấp.
- `warehouse/services/sheetSync`: đồng bộ đúng 6 tab Google Sheet.
- `warehouse/services/driveSync`: ảnh nhập kho và retry.
- `warehouse/services/notifications`: thông báo chỉ vào nhóm tạo đơn.
- `warehouse/repositories`: toàn bộ câu SQL kho tập trung tại một lớp.
- `warehouse/validators`: xác thực số nguyên, cơ sở, quyền và payload.

File `timekeep_bot.js` chỉ nên gắn router/composer kho và gọi module, không tiếp tục chứa toàn bộ nghiệp vụ mới.

### 30.3. Danh sách vùng không được tác động

Trong đợt cập nhật kho, không được thay đổi hành vi của:

- Nhắc check-in và xử lý đi muộn.
- Đăng ký lịch làm việc.
- Xin nghỉ và duyệt nghỉ.
- KPI báo cáo ngày.
- Nhắc KPI và phạt KPI.
- Tạm dừng KPI theo nhóm.
- Hồ sơ khách hàng và upload media khách hàng.
- Cơ chế reply ảnh/video khách hàng qua Telegram.
- Nhập kho/xuất kho cũ trước khi nhóm được bật bản mới.
- Các role guard của nhóm không phải warehouse.
- Cấu hình Sheet/Drive của customer, report và timekeep.

Nếu cần sửa hàm dùng chung, phải bổ sung test hồi quy cho tất cả nơi đang gọi hàm đó trước khi triển khai.

## 31. Kế hoạch migration database

### 31.1. Khảo sát trước migration

- Chụp schema hiện tại của `tk_products`, `tk_inventory` và `tk_warehouse_transactions`.
- Đếm giao dịch theo trạng thái, loại, cơ sở và nhóm.
- Kiểm tra dòng tồn âm hoặc dữ liệu branch ngoài `US/UK`.
- Kiểm tra khóa ngoại và index hiện tại.
- Đối chiếu tồn database với Google Sheet.
- Ghi lại bản sao cấu hình nhóm warehouse.
- Không tự động sửa dữ liệu bất thường; lập báo cáo để xử lý riêng.

### 31.2. Bảng dịch vụ

Tạo bảng danh mục dịch vụ với tối thiểu:

- ID.
- Mã dịch vụ duy nhất.
- Tên dịch vụ.
- Trạng thái hoạt động.
- Thứ tự hiển thị.
- Người tạo/cập nhật.
- Thời gian tạo/cập nhật.

### 31.3. Bảng sản phẩm mẫu theo dịch vụ

Tạo bảng liên kết dịch vụ–sản phẩm với:

- Dịch vụ.
- Sản phẩm.
- Số lượng mặc định nguyên dương.
- Trạng thái hiển thị/tạm ẩn.
- Thứ tự hiển thị.
- Người cập nhật.
- Thời gian cập nhật.
- Unique `(service_id, product_id)`.

### 31.4. Bảng lịch sử mẫu

Lưu audit khi Admin:

- Thêm sản phẩm.
- Tắt/bật sản phẩm.
- Sửa số lượng.
- Đổi thứ tự.
- Bật/tắt dịch vụ.

### 31.5. Bảng đơn xuất theo khách

Tạo bảng đầu đơn với:

- Mã đơn duy nhất.
- Nhóm Telegram tạo đơn.
- Người tạo.
- Tên khách.
- Số điện thoại.
- Cơ sở `US/UK`.
- Trạng thái.
- Người duyệt và thời gian duyệt.
- Khóa chống gửi trùng.
- Trạng thái đồng bộ Sheet/Telegram.
- Thời gian tạo/cập nhật.

### 31.6. Bảng dịch vụ trong đơn

Mỗi dịch vụ được chọn là một dòng riêng để giữ đúng cấu trúc hiển thị, kể cả nhiều dịch vụ dùng cùng sản phẩm.

Lưu:

- Đơn.
- Dịch vụ gốc.
- Tên/mã dịch vụ chụp tại thời điểm tạo.
- Thứ tự hiển thị.

### 31.7. Bảng sản phẩm trong từng dịch vụ của đơn

Lưu riêng từng dòng sản phẩm theo dịch vụ:

- Dịch vụ trong đơn.
- Sản phẩm.
- Tên/mã/đơn vị chụp tại thời điểm tạo.
- Số lượng mẫu.
- Số lượng thực tế.
- Nguồn từ mẫu hoặc thêm thủ công.
- Trạng thái bị loại khỏi đơn.
- Thứ tự hiển thị.

Không dùng bảng tổng đã gộp làm dữ liệu hiển thị cho nhân viên.

### 31.8. Bảng quyền kho theo nhóm

Quyền kho phải độc lập với role tự chọn và độc lập theo nhóm Telegram.

Khóa đề xuất:

```text
(employee_id, telegram_group_id, permission_code)
```

Các quyền tối thiểu:

- Duyệt xuất kho.
- Tự duyệt đơn do mình tạo.
- Duyệt điều chuyển.
- Quản lý mẫu dịch vụ.
- Quản lý sản phẩm.
- Sửa sai giao dịch.
- Xem báo cáo kho.

Phải có audit cấp/thu hồi quyền.

### 31.9. Bảng điều chuyển nội bộ

Lưu:

- Mã điều chuyển.
- Đơn liên quan.
- Nhóm Telegram tạo đơn.
- Cơ sở gửi/nhận.
- Người xác nhận.
- Thời gian.
- Trạng thái đã thông báo.

Chi tiết sản phẩm điều chuyển lưu thành nhiều dòng.

Không có trường người vận chuyển hoặc xác nhận hai phía.

### 31.10. Sổ biến động kho

Mọi lần tăng/giảm tồn phải có dòng sổ bất biến gồm:

- Loại giao dịch.
- Chứng từ liên quan.
- Cơ sở.
- Sản phẩm.
- Số lượng tăng/giảm.
- Tồn trước/sau.
- Người thao tác.
- Thời gian.

Tạo index phục vụ đối chiếu theo tháng, cơ sở, sản phẩm và chứng từ.

### 31.11. Yêu cầu migration

- Migration chạy trong transaction khi có thể.
- Chạy lặp không lỗi.
- Chỉ thêm bảng/cột/index trong lần đầu; không đổi hành vi production trước khi bật feature flag.
- Không backfill đơn khách giả từ giao dịch cũ.
- Giao dịch cũ tiếp tục hiển thị trong báo cáo legacy.
- Có script kiểm tra schema và constraint sau migration.
- Có hướng dẫn rollback logic; không phụ thuộc vào việc xóa bảng mới để quay lui.

## 32. Backend API cần xây dựng

### 32.1. API Web Admin – dịch vụ

- Danh sách dịch vụ.
- Tạo dịch vụ.
- Sửa tên và thứ tự.
- Bật/tắt dịch vụ.
- Xem lịch sử chỉnh sửa.

### 32.2. API Web Admin – sản phẩm mẫu

- Lấy sản phẩm mẫu của dịch vụ.
- Thêm sản phẩm có sẵn.
- Sửa số lượng mặc định.
- Đổi thứ tự.
- Bật/tắt sản phẩm mẫu.
- Xem trước dữ liệu Mini App.

### 32.3. API Web Admin – quyền kho

- Lấy danh sách nhân viên của nhóm warehouse đang chọn.
- Lấy quyền kho hiện tại.
- Cấp/thu hồi từng quyền.
- Trả audit quyền.

Tất cả API phải kiểm tra quyền Admin và phạm vi nhóm; không được coi request thiếu header là Super Admin trong production.

### 32.4. API Mini App – danh mục

- Danh sách dịch vụ đang hoạt động.
- Chi tiết mẫu dịch vụ.
- Danh sách sản phẩm đang hoạt động.
- Tra sản phẩm theo mã vạch.
- Tồn US và UK.

### 32.5. API Mini App – khách hàng

- Gợi ý tên khách theo số điện thoại.
- Chỉ trả dữ liệu cần thiết cho form kho.
- Không sửa bản ghi hồ sơ khách hàng của role customer.

### 32.6. API Mini App – đơn

- Lưu nháp.
- Cập nhật nháp của chính người tạo.
- Tính tổng ngầm theo sản phẩm.
- Kiểm tra tình trạng tồn.
- Gửi đơn.
- Xem trạng thái đơn.

### 32.7. API duyệt đơn

- Duyệt đơn.
- Từ chối đơn.
- Kiểm tra quyền theo bảng quyền kho.
- Khóa dòng tồn trong transaction.
- Kiểm tra lại tổng nhu cầu.
- Ghi điều chuyển nếu cần.
- Trừ tồn.
- Ghi sổ kho.
- Đánh dấu đơn đã duyệt.
- Trả kết quả chống duyệt trùng.

### 32.8. API nhập kho hiện tại

- Giữ tương thích payload đang dùng.
- Bắt buộc ảnh như hiện tại.
- Xác thực branch `US/UK` rõ ràng.
- Không thay đổi API customer upload.
- Chuyển dần phần xử lý Drive/Sheet sang module kho nhưng giữ response contract cũ.

### 32.9. Chuẩn validation

- Tên khách không rỗng.
- Số điện thoại không rỗng.
- Cơ sở chỉ nhận `US/UK`.
- Có ít nhất một dịch vụ.
- Có ít nhất một sản phẩm thực tế lớn hơn 0.
- Số lượng là số nguyên dương.
- Sản phẩm phải tồn tại và đang hoạt động.
- Nhóm phải đang hoạt động và có role warehouse.
- Người thao tác phải là thành viên đang hoạt động.

## 33. Web Admin cần hoàn thiện

### 33.1. Menu chỉ dành cho kho

- Thêm mục `Mẫu dịch vụ kho`.
- Chỉ hiển thị khi nhóm đang chọn có role warehouse hoặc người dùng là Super Admin.
- Không làm thay đổi menu KPI, chấm công và hồ sơ khách hàng.

### 33.2. Trang danh sách dịch vụ

- Tìm kiếm.
- Thêm/sửa.
- Bật/tắt.
- Sắp xếp.
- Hiển thị số sản phẩm mẫu.
- Mở trang chỉnh mẫu.

### 33.3. Trang chỉnh mẫu

- Tìm sản phẩm đã có.
- Thêm sản phẩm.
- Chỉnh số lượng nguyên.
- Tắt/bật sản phẩm.
- Sắp xếp kéo thả hoặc nút lên/xuống.
- Chặn sản phẩm trùng.
- Xem trước điện thoại.
- Hiển thị lịch sử chỉnh sửa.

### 33.4. Trang phân quyền kho

- Chỉ hiển thị quyền kho khi chọn nhóm warehouse.
- Checkbox riêng cho từng quyền.
- Không dùng dropdown role hiện tại làm quyền duyệt.
- Không thay đổi quyền check-in/KPI khi lưu quyền kho.
- Hiển thị người cấp và thời gian gần nhất.

### 33.5. Trải nghiệm và lỗi

- Có loading, empty state, lỗi API và toast thành công.
- Chống bấm lưu nhiều lần.
- Xác nhận trước khi tắt dịch vụ/sản phẩm mẫu.
- Không xóa dữ liệu vĩnh viễn từ UI.
- Hỗ trợ màn hình desktop và tablet cho Admin.

## 34. Mini App xuất kho cần hoàn thiện

### 34.1. Tách luồng cũ và mới

- Giữ form xuất kho cũ nguyên trạng cho nhóm chưa bật bản mới.
- Tạo form hoặc phiên bản mới cho đơn theo khách.
- Router chọn phiên bản dựa trên feature flag của đúng nhóm warehouse.
- Không đổi route của role khác.

### 34.2. Bước khách và cơ sở

- Tên khách.
- Số điện thoại.
- Gợi ý khách cũ.
- Chọn `US/MEDITECH` hoặc `UK`.
- Hiển thị cơ sở nổi bật trước khi gửi.

### 34.3. Bước dịch vụ

- Chọn nhiều dịch vụ.
- Tìm kiếm nhanh.
- Thẻ lớn phù hợp điện thoại.
- Chỉ hiển thị dịch vụ hoạt động.

### 34.4. Bước sản phẩm

- Khối riêng cho từng dịch vụ.
- Không gộp sản phẩm trùng trên giao diện.
- Tăng/giảm và nhập số lượng nguyên.
- Loại sản phẩm.
- Thêm sản phẩm đang có.
- Quét mã vạch.
- Tồn US/UK.

### 34.5. Cảnh báo tồn

- Cộng tổng ngầm theo product ID.
- Cảnh báo cơ sở hiện tại thiếu.
- Làm nổi bật nguồn đề xuất từ cơ sở kia.
- Chặn gửi/duyệt nếu tổng hai cơ sở không đủ.
- Không hiển thị cảnh báo chung chung; nêu từng sản phẩm và số thiếu.

### 34.6. Xác nhận và gửi

- Tóm tắt theo dịch vụ.
- Hiển thị cơ sở.
- Hiển thị điều chuyển dự kiến.
- Nút gửi cố định phía dưới.
- Idempotency key chống tạo trùng.
- Tự lưu nháp.

## 35. Transaction duyệt và trừ kho

Đây là phần có rủi ro cao nhất và phải hoàn thành trước khi mở production.

Trình tự bắt buộc trong một database transaction:

1. Khóa đơn bằng `SELECT ... FOR UPDATE`.
2. Xác nhận đơn vẫn chờ duyệt.
3. Kiểm tra quyền người duyệt theo đúng group.
4. Gom tổng số lượng theo product ID.
5. Khóa tồn US và UK của toàn bộ sản phẩm theo thứ tự cố định để tránh deadlock.
6. Kiểm tra không sản phẩm nào thiếu tổng hệ thống.
7. Tính nguồn xuất tại cơ sở thực hiện và phần điều chuyển.
8. Trừ tồn cơ sở thực hiện.
9. Trừ tồn cơ sở gửi điều chuyển.
10. Tạo chứng từ điều chuyển nếu có.
11. Tạo các dòng sổ biến động.
12. Cập nhật đơn thành APPROVED.
13. Lưu người duyệt và thời gian.
14. Commit.

Sau commit mới:

- Trả kết quả thành công.
- Xếp tác vụ đồng bộ Sheet.
- Gửi thông báo Telegram.

Tuyệt đối không trừ tồn sau khi đã trả thành công cho Mini App.

## 36. Google Sheet và Google Drive

### 36.1. Google Sheet

- Kiểm tra và giữ nguyên 5 tab hiện tại.
- Tạo tab `6. Điều chuyển nội bộ` nếu chưa có.
- Không xóa hoặc đổi tên tab.
- Ghi đơn xuất thành nhiều dòng theo dịch vụ.
- Ghi nguồn hàng và mã điều chuyển.
- Cập nhật tồn US, UK và tổng kho từ database.
- Có khóa chống ghi trùng theo mã giao dịch.
- Có retry và log lỗi.

### 36.2. Google Drive

- Chỉ nhập kho bắt buộc ảnh.
- Giữ cấu hình folder kho độc lập với customer Drive.
- Không dùng chung tác vụ xóa file của hồ sơ khách hàng.
- Lưu trạng thái upload trong database.
- Chỉ xóa file tạm sau khi lưu link thành công.
- Có retry khi Google lỗi.

## 37. Feature flag và triển khai từng nhóm

### 37.1. Cờ bật riêng theo group

Thêm cấu hình, ví dụ `warehouse_service_order_enabled`, trên từng nhóm warehouse.

- Mặc định `false` sau migration.
- `false`: nhóm tiếp tục dùng luồng xuất kho cũ.
- `true`: nhóm dùng đơn khách và mẫu dịch vụ mới.
- Nhóm role khác luôn bỏ qua cờ này.

### 37.2. Thứ tự triển khai

1. Chạy migration.
2. Deploy backend nhưng giữ flag tắt.
3. Deploy Web Admin.
4. Admin tạo mẫu dịch vụ.
5. Test nội bộ bằng nhóm thử nghiệm.
6. Đối chiếu tồn trước khi bật.
7. Bật một nhóm warehouse.
8. Theo dõi API, DB, Sheet và log.
9. Khi ổn định mới bật các nhóm warehouse còn lại.

### 37.3. Quay lui

Nếu có lỗi:

- Tắt feature flag của nhóm.
- Nhóm quay về Mini App xuất kho cũ.
- Không xóa bảng mới.
- Không rollback/xóa giao dịch đã duyệt.
- Khắc phục lỗi và đối chiếu tồn trước khi bật lại.

## 38. Bộ test không ảnh hưởng chức năng khác

### 38.1. Test kho mới

- Schema, constraint và migration lặp.
- CRUD dịch vụ/mẫu.
- Quyền kho theo group.
- Đơn nhiều dịch vụ và sản phẩm trùng.
- Tùy chỉnh không sửa mẫu.
- Duyệt và tự duyệt.
- Điều chuyển hai chiều.
- Không tồn âm.
- Hai request duyệt đồng thời.
- Idempotency.
- Sheet 6 tab.
- Drive nhập kho.

### 38.2. Test hồi quy role timekeep

- Đăng ký nhân viên.
- Đăng ký lịch.
- Check-in video.
- Nhắc check-in trước 5 phút.
- Ghi nhận đi muộn.
- Xin nghỉ và duyệt nghỉ.

### 38.3. Test hồi quy role report/report_tour

- Đăng ký nhóm KPI.
- Nộp báo cáo.
- Ảnh minh chứng.
- Nhắc KPI.
- Tạm dừng theo nhóm.
- Đăng ký nhóm khác không kích hoạt nhóm đã tạm dừng.

### 38.4. Test hồi quy role customer/customer_record

- Mở form khách hàng.
- Lưu thông tin khách.
- Upload media.
- Reply media qua Telegram.
- Đồng bộ Drive/Sheet riêng của customer.

### 38.5. Test role guard

- API warehouse từ nhóm timekeep phải bị chặn.
- API warehouse từ nhóm report phải bị chặn.
- API customer từ nhóm warehouse không được tự mở.
- Handler Telegram kho chỉ phản ứng trong nhóm warehouse.
- Thông báo điều chuyển chỉ tới group tạo đơn.

### 38.6. Test Web Admin

- Menu kho chỉ hiện đúng điều kiện.
- Lưu quyền kho không đổi quyền KPI/check-in.
- Lưu mẫu không đổi cấu hình group khác.
- Build production và lint các file thay đổi.

## 39. Kiểm tra trước khi triển khai production

- Backup database.
- Ghi lại tồn từng sản phẩm tại US và UK.
- Đối chiếu Google Sheet hiện tại.
- Xác nhận không có pending warehouse request chưa xử lý hoặc có kế hoạch tương thích.
- Chạy syntax check backend.
- Chạy build Web Admin.
- Chạy test migration trên database thử nghiệm hoặc transaction rollback.
- Chạy test API tự động.
- Kiểm tra quyền Admin và quyền nhóm.
- Bật flag cho đúng một nhóm thử.
- Không restart Cloudflare tunnel nếu không cần.
- Restart riêng service bị thay đổi.
- Kiểm tra health, PM2 và log mới.

## 40. Điều kiện hoàn thành kỹ thuật

Chỉ đánh dấu hoàn thành khi:

1. Tất cả API kho mới có role guard và permission check.
2. Quyền duyệt không còn dựa vào role tự chọn.
3. Duyệt/trừ tồn/điều chuyển/sổ kho nằm trong một transaction.
4. Không thể tạo tồn âm qua API hoặc callback Telegram.
5. Mini App hiển thị riêng sản phẩm theo dịch vụ.
6. Web Admin quản lý đầy đủ mẫu dịch vụ.
7. Sheet có đúng 6 tab và không mất dữ liệu cũ.
8. Nhập kho vẫn bắt buộc ảnh và upload nền an toàn.
9. Feature flag hoạt động độc lập theo group warehouse.
10. Tắt flag quay về luồng cũ mà không mất dữ liệu.
11. Bộ test kho mới pass.
12. Bộ test hồi quy timekeep pass.
13. Bộ test hồi quy report/report_tour pass.
14. Bộ test hồi quy customer/customer_record pass.
15. PM2, health và log production không có lỗi mới.
16. Tồn database, Google Sheet và kiểm kê thử khớp nhau.

## 41. Tài liệu kiến trúc và triển khai

- Cấu trúc module hiện tại: `apps/bot/src/modules/warehouse/README.md`.
- Quyết định kiến trúc modular monolith: `docs/adr/0001-warehouse-modular-monolith.md`.
- Các giai đoạn chạy từ local đến production: `docs/warehouse_delivery_runbook.md`.

Việc tách cấu trúc backend là giai đoạn đầu; các hạng mục nghiệp vụ sau đó đã được triển khai và kiểm tra theo điều kiện trong runbook. Rollout production vẫn phải tuân thủ feature flag và bước đối chiếu kho thật.

## 42. Kết quả triển khai

Các hạng mục trong kế hoạch đã được hiện thực hóa tại:

- `packages/warehouse`: domain, validation, repository và transaction đơn kho.
- `packages/database/migrations/v19_warehouse_service_orders.sql`: schema, constraint, ledger, outbox và feature flag.
- `apps/bot/src/modules/warehouse`: HTTP, callback Telegram, Sheet và background worker.
- `apps/bot/public/warehouse_order.html`: Mini App đơn khách nhiều dịch vụ.
- `apps/bot/public/warehouse_import.html`: chỉ nhận ảnh, tối đa 6 ảnh và nén trên điện thoại.
- `apps/api/src/modules/warehouse-admin`: API quản trị kho có xác thực/phạm vi group.
- `apps/web-admin/src/WarehouseManagement.jsx`: giao diện mẫu, sản phẩm, quyền, đơn, sổ kho, đồng bộ nền và rollout.

Database là nguồn dữ liệu chính. Google Sheet, Google Drive và Telegram chạy sau commit qua outbox; Admin xem lỗi và yêu cầu thử lại trên tab `Đồng bộ nền`.

Feature flag của từng group vẫn để tắt sau migration. Đây là chủ ý an toàn: Admin cấu hình mẫu/quyền và bật từng group sau khi đối chiếu tồn, không bật đồng loạt tự động.
