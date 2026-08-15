import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./WarehouseManagement.jsx', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('./App.jsx', import.meta.url), 'utf8');

test('Web Admin kho chỉ quản lý mẫu sản phẩm theo dịch vụ', () => {
  assert.match(source, /warehouse-catalog/);
  assert.match(fs.readFileSync(new URL('./index.css', import.meta.url), 'utf8'), /warehouse-catalog/);
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

test('Danh mục mẫu không gửi group_id và không yêu cầu chọn nhóm', () => {
  assert.doesNotMatch(source, /selectedGroupId/);
  assert.doesNotMatch(source, /group_id/);
  assert.match(source, /request\('\/admin\/warehouse\/services'\)/);
  assert.match(source, /request\('\/admin\/warehouse\/products'\)/);
  assert.match(appSource, /activeTab !== 'warehouse'/);
  assert.match(appSource, /<WarehouseManagement \/>/);
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
