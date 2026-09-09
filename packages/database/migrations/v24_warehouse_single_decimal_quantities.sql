BEGIN;

-- Không âm thầm làm tròn dữ liệu lịch sử. Migration chỉ chạy khi mọi số lượng
-- hiện có đã phù hợp với quy tắc tối đa một chữ số sau dấu thập phân.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.tk_inventory WHERE quantity <> ROUND(quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_transactions WHERE quantity <> ROUND(quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_service_products WHERE default_quantity <> ROUND(default_quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_order_items WHERE template_quantity <> ROUND(template_quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_order_items WHERE actual_quantity <> ROUND(actual_quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_order_items WHERE local_allocated_quantity <> ROUND(local_allocated_quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_order_items WHERE transfer_allocated_quantity <> ROUND(transfer_allocated_quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_transfer_items WHERE quantity <> ROUND(quantity, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_ledger WHERE quantity_delta <> ROUND(quantity_delta, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_ledger WHERE balance_before <> ROUND(balance_before, 1))
        OR EXISTS (SELECT 1 FROM public.tk_warehouse_ledger WHERE balance_after <> ROUND(balance_after, 1)) THEN
        RAISE EXCEPTION 'Warehouse quantity data contains values with more than one decimal place';
    END IF;
END $$;

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
