import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./WarehouseManagement.jsx', import.meta.url), 'utf8');
const productSource = fs.readFileSync(new URL('./ProductManagement.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../../app/App.jsx', import.meta.url), 'utf8');

test('Web Admin kho chỉ quản lý mẫu sản phẩm theo dịch vụ', () => {
  assert.match(source, /warehouse-catalog/);
  assert.match(fs.readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8'), /warehouse-catalog/);
  assert.match(source, /Mẫu sản phẩm theo dịch vụ/);
  assert.match(source, /Dịch vụ/);
  assert.match(source, /Mặt hàng khi nhân viên chọn dịch vụ/);
  assert.match(source, /Số lượng mặc định/);
  assert.match(source, /Lưu mẫu dịch vụ/);
  assert.doesNotMatch(source, /Đơn xuất khách/);
  assert.doesNotMatch(source, /Người được duyệt/);
  assert.doesNotMatch(source, /Đồng bộ nền/);
  assert.doesNotMatch(source, /Mở cho nhân viên/);
});

test('Mục Quản lý kho luôn hiện và báo rõ khi tài khoản chưa được cấp quyền', () => {
  assert.match(appSource, /label: 'Quản lý kho'/);
  assert.doesNotMatch(appSource, /needsWarehouse/);
  assert.match(appSource, /Chưa được cấp quyền quản lý kho/);
  assert.match(appSource, /<WarehouseAccessNotice \/>/);
});

test('Danh mục mẫu không gửi group_id và không yêu cầu chọn nhóm', () => {
  assert.doesNotMatch(source, /selectedGroupId/);
  assert.doesNotMatch(source, /group_id/);
  assert.match(source, /request\('\/admin\/warehouse\/services'\)/);
  assert.match(source, /request\('\/admin\/warehouse\/products'\)/);
  assert.match(appSource, /activeTab !== 'warehouse'/);
  assert.match(appSource, /<WarehouseManagement groups=/);
});

test('Kho có menu con Quản lý sản phẩm với đường dẫn riêng', () => {
  assert.match(source, /Quản lý sản phẩm/);
  assert.match(source, /\/kho\/san-pham/);
  assert.match(source, /label: 'Quản lý sản phẩm'[\s\S]*label: 'Mẫu theo dịch vụ'/);
  assert.match(source, /useLocation/);
  assert.match(source, /<ProductManagement groups=\{groups\}/);
});

test('Quản lý sản phẩm chỉ cho đổi tên, tồn US và UK là dữ liệu chỉ đọc', () => {
  assert.match(productSource, /data: \{ product_name: productName, base_unit: baseUnit \}/);
  assert.match(productSource, /Tồn US/);
  assert.match(productSource, /Tồn UK/);
  assert.match(productSource, /tồn kho là dữ liệu chỉ đọc/);
  assert.doesNotMatch(productSource, /data: \{[^}]*stock_us/);
  assert.doesNotMatch(productSource, /data: \{[^}]*stock_uk/);
});

test('Web Admin tạo phiếu nhập kho theo nhóm, cơ sở và danh sách sản phẩm', () => {
  assert.match(productSource, /Tạo phiếu nhập kho/);
  assert.match(productSource, /request\('\/admin\/warehouse\/imports'/);
  assert.match(productSource, /group_id: groupId/);
  assert.match(productSource, /branch, note, items/);
  assert.match(productSource, /Xác nhận nhập kho/);
});

test('Admin có thể thêm sửa xóa dịch vụ và mặt hàng trong mẫu', () => {
  assert.match(source, /Thêm dịch vụ/);
  assert.match(source, /Lưu tên/);
  assert.match(source, /Xóa dịch vụ/);
  assert.match(source, /removeItem/);
  assert.match(source, /default_quantity/);
  assert.match(source, /function suggestServiceCode/);
});

test('Danh sách sản phẩm hiển thị trực tiếp, không bị ẩn trong ô chọn', () => {
  assert.match(source, /Danh mục sản phẩm có thể thêm/);
  assert.match(source, /Sản phẩm đã chọn cho dịch vụ/);
  assert.match(source, /selectableProducts\.map\(product/);
  assert.match(source, /onClick=\{\(\) => addProduct\(product\.id\)\}/);
  assert.match(source, /product\.stock_us/);
  assert.match(source, /product\.stock_uk/);
  assert.doesNotMatch(source, /\+ Chọn mặt hàng để thêm/);
});

test('Admin cấu hình số nguyên hoặc số thập phân riêng cho từng sản phẩm', () => {
  assert.match(source, /quantity_mode/);
  assert.match(source, /updateProductQuantityMode/);
  assert.match(source, /Chỉ nhập số nguyên/);
  assert.match(source, /Cho nhập thập phân/);
  assert.match(source, /inputMode=\{item\.quantity_mode === 'DECIMAL' \? 'decimal' : 'numeric'\}/);
});

test('Admin cấu hình đơn vị tính cơ sở và quy đổi đóng gói khi nhập', () => {
  assert.match(source, /ProductUnitsModal/);
  assert.match(source, /saveProductUnits/);
  assert.match(source, /Bật quy đổi đóng gói khi nhập hàng/);
  assert.match(source, /base_unit/);
  assert.match(source, /import_unit/);
  assert.match(source, /conversion_rate/);
});
