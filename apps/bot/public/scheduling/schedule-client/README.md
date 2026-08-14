# Mini App lịch khách (nhân viên)

Màn hình nhân viên dùng để đặt lịch, sửa/hủy, trả ảnh nhiệm vụ và **báo bù công tour**.

## Điểm vào

`/mini-app/schedule_client.html` → nạp `app.js`. URL giữ nguyên để nút "Lịch Khách"
của bot, `router.html` và ba đường mở đặc biệt không phải đổi.

| Đường mở | Kết quả |
|---|---|
| `?payload=scheduleclient_<gid>_<ts>_<sig>` | mở tab Check lịch |
| `?payload=makeupclient_…` hoặc `?tab=makeup` | mở thẳng tab Báo Bù |
| `?tab=edit` | mở tab Sửa/Hủy và tự tìm lịch gần đây |
| `?action=update&id=…` | ẩn thanh tab, mở tab Thêm ở **chế độ cập nhật** |

## Cấu trúc

```text
scheduling/schedule-client/
├── app.js                    Điều phối 5 tab, gate vai trò, ba đường mở đặc biệt
├── theme.css                 Layout (màu lấy từ ../../shared-ui/theme-tokens.css)
├── domain/
│   └── schedule-rules.js     Quy tắc thuần: định dạng số buổi, ngày giờ, trạng thái
├── data/
│   └── schedule-repo.js      Toàn bộ lời gọi API
├── media/
│   └── photo.js              Thu nhỏ ảnh → base64
├── ui/
│   └── components.js         Alert, form, timeline, badge, modal
└── tabs/
    ├── check-tab.js          Tab 1 — xem lịch theo ngày
    ├── add-tab.js            Tab 2 — thêm lịch / cập nhật
    ├── edit-tab.js           Tab 3 — tìm theo SĐT, sửa giờ, hủy
    ├── tasks-tab.js          Tab 4 — nợ ảnh trong ngày
    └── makeup-tab.js         Tab 5 — Báo Bù Công Tour
```

Hạ tầng dùng chung ở [`../../shared-ui/`](../../shared-ui/README.md).

Hướng phụ thuộc: `tabs` → `ui` / `data` / `media` → `domain` → `shared-ui/core`.

## Chuyển tab bằng CSS, không bằng JS

Tab dùng `<input type="radio">` ẩn + `<label>`, đúng như bản cũ. JS chỉ nghe sự kiện
`change` để biết lúc nào cần nạp dữ liệu. Nhờ vậy một tab lỗi vẫn chuyển sang tab khác
được — **đừng thay bằng chuyển tab bằng JS**.

## Gate theo vai trò nhóm

`GET /api/groups/role` quyết định:

| Nhóm | Tab Báo Bù | Ô Bác sĩ / Điều dưỡng | Nút "Cập nhật" ở tab Sửa |
|---|---|---|---|
| `report_tour` | hiện | hiện | hiện |
| khác | ẩn | ẩn | ẩn |

Lỗi mạng khi hỏi vai trò thì coi như **không phải** tour — thà ẩn tính năng còn hơn mở
nhầm cho nhóm không có quyền.

## Báo Bù Công Tour — hai loại yêu cầu

| Loại | Hành vi |
|---|---|
| `EXISTING_APPOINTMENT` | Chọn lịch cũ từ danh sách; 6 ô thông tin bị **khoá** và đổ theo lịch gốc |
| `MISSING_APPOINTMENT` | Nhập tay toàn bộ |

Bác sĩ / điều dưỡng luôn cho nhập ở cả hai loại, và được **nối vào phần lý do** vì bảng
`tour_makeup_requests` chưa có cột riêng cho hai trường này.

## Nguyên tắc khi sửa

1. **Không dựng HTML từ dữ liệu khách.** Bản cũ nối thẳng tên khách, SĐT và tên nhân
   viên vào `innerHTML` ở 4/5 tab — chỉ tab Báo Bù escape thủ công. Dùng `h()`.
2. **Ảnh gửi dạng base64 trong JSON**, không phải FormData: hai endpoint
   `/api/upload-proof` và `/api/schedules/makeup` nhận `imageBase64`. Đổi ở đây là phải
   đổi cả server.
3. **Xác thực khác Mini App kho** — dùng `groupId` + `telegram_id` + header
   `x-telegram-init-data`, KHÔNG có chữ ký `ts`/`sig`.
4. **Chế độ cập nhật khoá tên/SĐT/giờ**: đổi ba thứ đó là thành một lịch hẹn khác.

## Test

```powershell
npm run test:scheduling-miniapp
```
