# Mini App nhập kho

Ghi nhận hàng nhập vào một cơ sở, cho group có `bot_role = 'warehouse'`.

Khác xuất kho ở chỗ **nhập kho không cần duyệt**: gửi xong là tồn kho cộng ngay
(`APPROVED`). Vì vậy bước xác nhận phải hiện lại đủ thông tin trước khi gửi.

## Điểm vào

`/mini-app/warehouse_import.html` → nạp `app.js`. URL giữ nguyên như bản cũ để nút
"Nhập Kho" của bot, `router.html` và lệnh `/start whimport_...` không phải đổi.

## Cấu trúc

```text
warehouse-import/
├── app.js                      Điều phối 4 bước, giữ state phiếu, gọi API gửi
├── theme.css                   Design token + toàn bộ style
├── domain/
│   └── import-draft.js         Quy tắc phiếu nhập — hàm thuần, không DOM/network
├── data/
│   └── import-repo.js          Gọi API thật + gửi phiếu qua XHR (có tiến độ)
├── media/
│   └── image-compressor.js     Nén ảnh minh chứng về ~350KB
├── ui/
│   └── components.js           TopBar, nút, thẻ, ô nhập, dòng sản phẩm, ô ảnh
└── steps/
    ├── branch-step.js          Bước 1: chọn cơ sở
    ├── products-step.js        Bước 2: thêm sản phẩm
    ├── photos-step.js          Bước 3: ảnh minh chứng
    ├── confirm-step.js         Bước 4: xem lại + tiến độ gửi
    ├── scan-sheet.js           Sheet sau khi quét được mã
    ├── manual-add-sheet.js     Sheet nhập tay (gợi ý + tạo mới)
    ├── items-sheet.js          Sheet xem lại/xóa dòng trong phiếu
    └── done-screen.js          Màn hình thành công
```

Hạ tầng dùng chung (`core/*`, `ui/icons.js`, `ui/scanner.js`) nằm ở
[`../../shared-ui/`](../../shared-ui/README.md).

Hướng phụ thuộc một chiều: `steps` → `ui` / `data` / `media` → `domain` →
`shared-ui/core`. `domain/` không import gì ngoài chính nó.

## Bốn bước

| Bước | Điều kiện đi tiếp | Ghi chú |
|---|---|---|
| 1. Cơ sở nhận hàng | đã chọn US hoặc UK | Hàng chỉ cộng vào cơ sở này |
| 2. Thêm sản phẩm | ≥ 1 sản phẩm | Quét mã hoặc nhập tay, cộng dồn theo mã vạch |
| 3. Ảnh minh chứng | ≥ 1 ảnh (tối đa 6) | Chỉ ảnh, không nhận video |
| 4. Xác nhận | — | Gửi là ghi nhận ngay, không quay lại được |

`checkStep()` trong `domain/import-draft.js` là nơi duy nhất định nghĩa các điều
kiện này, và `submit()` kiểm lại **cả bốn** trước khi gửi — nhân sự có thể lùi lại
xóa hết ảnh rồi tiến tới bấm gửi.

## Dữ liệu

| Dùng để | API thật |
|---|---|
| Danh mục gợi ý khi nhập tay | `GET /api/warehouse/products` |
| Tra mã vừa quét là cũ hay mới | `GET /api/products/by-barcode/:barcode` |
| Mã vạch đề xuất cho sản phẩm mới | `GET /api/warehouse/next-barcode` |
| Gửi phiếu + ảnh | `POST /api/warehouse/import` (multipart) |

## Ba lớp chặn trùng mã vạch — đừng bỏ lớp nào

Sự cố thật: UK nhập "Cannula 23g" mã `002`; sau đó US nhập tay "Kim canula27g" cũng
gõ mã `002`. Câu upsert cũ `ON CONFLICT DO UPDATE product_name` đã **âm thầm** đổi tên
sản phẩm cũ và gộp tồn kho hai mặt hàng làm một — tên "Cannula 23g" biến mất, 5 cái
của UK bị dán nhãn sai.

1. **Ở đây (client)** — `checkBarcodeOwnership()` báo ngay lúc nhân sự bấm Thêm, xét
   cả danh mục hệ thống và các dòng đã có trong phiếu. Chỉ để báo sớm cho dễ chịu,
   **không phải** chốt an toàn.
2. **`import-routes.js`** đọc `tk_products` trước khi ghi và trả 409 kèm tên đang giữ mã.
3. **Database** — mệnh đề `WHERE` của `ON CONFLICT` chỉ cho "nhận" sản phẩm đã tồn tại
   khi tên khớp. Đây là lớp duy nhất chặn được việc hai cơ sở lưu **cùng lúc**.

Liên quan: tra cứu mã vạch thất bại **không được** coi là "sản phẩm mới". Nếu mã đó
thật ra đã tồn tại, việc đặt tên mới sẽ ghi đè tên cũ. `scan-sheet.js` nhánh
`renderLookupFailed()` chỉ cho quét lại hoặc đóng — không có ô nhập tên, không có ô
số lượng.

## Những gì cố tình KHÔNG có

- **Đơn vị tính** ("chai", "miếng"): `tk_products` chỉ có `id`, `barcode`,
  `product_name`, `is_active`, `created_at`.
- **Đếm "quét trùng 3/3 lần"**: `barcode-scanner.js` đã tự chống nhận dạng nhầm (đòi
  đọc trùng mã trong 1200ms + kiểm checksum) rồi tự dừng camera. Đếm thêm ở UI là hai
  lớp xác nhận chồng nhau.
- **Ghi chú cho phiếu nhập**: chưa có cột trong `tk_warehouse_transactions`.
- **Video minh chứng**: luồng nhập kho không lưu video.

## Nguyên tắc khi sửa

1. **Không hardcode sản phẩm hay mã vạch.** Danh mục rỗng thì hiện trạng thái rỗng.
2. **Không dùng `innerHTML`.** Dùng `h()` trong `../../shared-ui/core/dom.js`.
3. **Giữ XHR cho việc gửi phiếu**, đừng đổi sang `fetch`: mất tiến độ tải lên thì
   nhân sự tưởng treo và bấm gửi nhiều lần → nhập kho trùng.
4. **Tiến độ chặn ở 99%** khi vẫn đang tải; 100% chỉ khi ảnh đã lên xong.
5. **Đừng thêm bước duyệt vào đây.** Nhập kho là ghi nhận ngay; muốn có duyệt thì
   phải sửa cả `import-routes.js` và bảng giao dịch.
6. **Ô nhập không được vẽ lại khi đang gõ** — con trỏ trên điện thoại sẽ nhảy về đầu.
   Xem cách tách slot trong `manual-add-sheet.js`.

## Test

```powershell
npm run test:warehouse-miniapp
npm run test:warehouse-import-db   # cần DATABASE_URL
npm run check:warehouse
```
