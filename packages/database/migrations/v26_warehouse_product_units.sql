BEGIN;

-- Thêm đơn vị tính cơ sở (dùng khi xuất và lưu tồn: ml, chiếc, unit, tuýp...)
ALTER TABLE public.tk_products
    ADD COLUMN IF NOT EXISTS base_unit VARCHAR(50) NOT NULL DEFAULT 'chiếc';

-- Thêm đơn vị nhập đóng gói (lọ, hộp, chai...; NULL nếu không quy đổi)
ALTER TABLE public.tk_products
    ADD COLUMN IF NOT EXISTS import_unit VARCHAR(50);

-- Hệ số quy đổi (1 import_unit = conversion_rate * base_unit)
ALTER TABLE public.tk_products
    ADD COLUMN IF NOT EXISTS conversion_rate NUMERIC(14,2) NOT NULL DEFAULT 1.0;

-- Ràng buộc hệ số quy đổi phải luôn dương
ALTER TABLE public.tk_products
    DROP CONSTRAINT IF EXISTS tk_products_conversion_rate_check;
ALTER TABLE public.tk_products
    ADD CONSTRAINT tk_products_conversion_rate_check
    CHECK (conversion_rate > 0);

-- Lưu vết đơn vị tại thời điểm giao dịch trong chi tiết đơn xuất
ALTER TABLE public.tk_warehouse_order_items
    ADD COLUMN IF NOT EXISTS unit_snapshot VARCHAR(50) DEFAULT 'chiếc';

COMMIT;
