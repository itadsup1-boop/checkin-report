BEGIN;

-- Mọi sản phẩm cũ giữ nguyên hành vi: chỉ nhận số nguyên. Admin có thể bật số
-- thập phân riêng cho từng sản phẩm trên Web Admin.
ALTER TABLE public.tk_products
    ADD COLUMN IF NOT EXISTS quantity_mode VARCHAR(12) NOT NULL DEFAULT 'INTEGER';

UPDATE public.tk_products
SET quantity_mode = 'INTEGER'
WHERE quantity_mode NOT IN ('INTEGER', 'DECIMAL') OR quantity_mode IS NULL;

ALTER TABLE public.tk_products
    DROP CONSTRAINT IF EXISTS tk_products_quantity_mode_check;
ALTER TABLE public.tk_products
    ADD CONSTRAINT tk_products_quantity_mode_check
    CHECK (quantity_mode IN ('INTEGER', 'DECIMAL'));

-- NUMERIC được dùng thay cho FLOAT để các phép cộng/trừ tồn kho chính xác và
-- không phát sinh sai số nhị phân. Nghiệp vụ chỉ dùng một chữ số sau dấu thập phân.
ALTER TABLE public.tk_inventory
    ALTER COLUMN quantity TYPE NUMERIC(14,1) USING quantity::NUMERIC(14,1);

ALTER TABLE public.tk_warehouse_transactions
    ALTER COLUMN quantity TYPE NUMERIC(14,1) USING quantity::NUMERIC(14,1);

ALTER TABLE public.tk_warehouse_service_products
    ALTER COLUMN default_quantity TYPE NUMERIC(14,1) USING default_quantity::NUMERIC(14,1);

ALTER TABLE public.tk_warehouse_order_items
    ALTER COLUMN template_quantity TYPE NUMERIC(14,1) USING template_quantity::NUMERIC(14,1),
    ALTER COLUMN actual_quantity TYPE NUMERIC(14,1) USING actual_quantity::NUMERIC(14,1),
    ALTER COLUMN local_allocated_quantity TYPE NUMERIC(14,1) USING local_allocated_quantity::NUMERIC(14,1),
    ALTER COLUMN transfer_allocated_quantity TYPE NUMERIC(14,1) USING transfer_allocated_quantity::NUMERIC(14,1);

ALTER TABLE public.tk_warehouse_transfer_items
    ALTER COLUMN quantity TYPE NUMERIC(14,1) USING quantity::NUMERIC(14,1);

ALTER TABLE public.tk_warehouse_ledger
    ALTER COLUMN quantity_delta TYPE NUMERIC(14,1) USING quantity_delta::NUMERIC(14,1),
    ALTER COLUMN balance_before TYPE NUMERIC(14,1) USING balance_before::NUMERIC(14,1),
    ALTER COLUMN balance_after TYPE NUMERIC(14,1) USING balance_after::NUMERIC(14,1);

COMMIT;
