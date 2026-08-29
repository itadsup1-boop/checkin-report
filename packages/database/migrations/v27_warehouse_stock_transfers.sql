BEGIN;

-- Chuyển kho (di chuyển hàng thật giữa hai cơ sở, không gắn với đơn xuất nào)
-- dùng lại bảng phiếu điều chuyển sẵn có thay vì tạo bảng mới, vì cấu trúc đã
-- đủ cột cần và đã được nối sẵn vào báo cáo sổ cái ở Web Admin.
--
-- order_id trước đây bắt buộc vì mọi phiếu điều chuyển đều sinh ra để bù ngay
-- cho một đơn xuất. Nới lỏng thành NULL để chuyển kho độc lập tồn tại được.
ALTER TABLE public.tk_warehouse_transfers
    ALTER COLUMN order_id DROP NOT NULL;

-- Phân biệt hai loại phiếu cùng nằm trong một bảng:
--   ORDER_ALLOCATION  phiếu cũ — lấy bù ngay cho một đơn xuất, order_id có giá trị
--   RESTOCK           phiếu mới — chuyển kho độc lập, order_id NULL
ALTER TABLE public.tk_warehouse_transfers
    ADD COLUMN IF NOT EXISTS transfer_type VARCHAR(20) NOT NULL DEFAULT 'ORDER_ALLOCATION';

ALTER TABLE public.tk_warehouse_transfers
    DROP CONSTRAINT IF EXISTS tk_warehouse_transfers_type_check;
ALTER TABLE public.tk_warehouse_transfers
    ADD CONSTRAINT tk_warehouse_transfers_type_check
    CHECK (transfer_type IN ('ORDER_ALLOCATION', 'RESTOCK'));

-- Phiếu ORDER_ALLOCATION vẫn phải có order_id; phiếu RESTOCK thì không.
ALTER TABLE public.tk_warehouse_transfers
    DROP CONSTRAINT IF EXISTS tk_warehouse_transfers_order_by_type_check;
ALTER TABLE public.tk_warehouse_transfers
    ADD CONSTRAINT tk_warehouse_transfers_order_by_type_check
    CHECK (
        (transfer_type = 'ORDER_ALLOCATION' AND order_id IS NOT NULL)
        OR (transfer_type = 'RESTOCK' AND order_id IS NULL)
    );

-- Sổ cái điều chuyển "dùng ngay" trước đây chỉ ghi TRANSFER_IN_DIRECT_USE (hàng
-- không thực sự nằm lại ở cơ sở đích, dùng metadata virtual_balance đánh dấu).
-- Chuyển kho là hàng THẬT nằm lại ở cơ sở đích nên cần một loại sự kiện riêng,
-- không được lẫn với loại "ảo" ở trên.
ALTER TABLE public.tk_warehouse_ledger
    DROP CONSTRAINT IF EXISTS tk_warehouse_ledger_event_type_check;
ALTER TABLE public.tk_warehouse_ledger
    ADD CONSTRAINT tk_warehouse_ledger_event_type_check
    CHECK (
        event_type IN (
            'PRODUCT_IMPORT',
            'CUSTOMER_EXPORT',
            'TRANSFER_OUT',
            'TRANSFER_IN_DIRECT_USE',
            'TRANSFER_IN',
            'ADJUSTMENT_INCREASE',
            'ADJUSTMENT_DECREASE',
            'REVERSAL'
        )
    );

COMMIT;
