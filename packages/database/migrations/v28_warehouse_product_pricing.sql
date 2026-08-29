BEGIN;

-- Lịch sử đơn giá sản phẩm: CHỈ INSERT, không bao giờ UPDATE/DELETE dòng cũ —
-- giá hiện tại luôn là dòng mới nhất theo created_at của đúng product_id đó.
-- Kế toán nhập giá mới không xoá giá cũ, để tra cứu lại được sau này.
CREATE TABLE IF NOT EXISTS public.tk_product_prices (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES public.tk_products(id) ON DELETE CASCADE,
    unit_price NUMERIC(14, 2) NOT NULL CHECK (unit_price >= 0),
    created_by_employee_id UUID REFERENCES public.employees(id),
    created_by_telegram_id VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tk_product_prices_product_created
    ON public.tk_product_prices (product_id, created_at DESC);

-- Giá tại thời điểm đơn được DUYỆT (không phải giá hiện tại) — snapshot đúng
-- quy ước *_snapshot đã dùng cho product_name/barcode/unit. NULL nghĩa là sản
-- phẩm chưa từng được kế toán nhập giá lúc duyệt đơn; đơn vẫn được duyệt bình
-- thường, phần thiếu giá sẽ được vá lại tự động khi có giá đầu tiên.
ALTER TABLE public.tk_warehouse_order_items
    ADD COLUMN IF NOT EXISTS unit_price_snapshot NUMERIC(14, 2);

-- Tổng tiền chốt sẵn lúc duyệt (và được tính lại mỗi khi vá giá) — tránh phải
-- join+sum lại từ đầu mỗi lần hiển thị "Xem tổng giá đơn xuất".
ALTER TABLE public.tk_warehouse_orders
    ADD COLUMN IF NOT EXISTS total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.tk_warehouse_orders
    ADD COLUMN IF NOT EXISTS has_missing_price BOOLEAN NOT NULL DEFAULT FALSE;

-- ID Google Sheet đơn giá — tách biệt hẳn với sheet xuất/nhập/tồn kho hiện có
-- (customer_sheet_id) để hạn chế người xem, điền riêng theo từng nhóm kho trên
-- Web Admin.
ALTER TABLE public.telegram_groups
    ADD COLUMN IF NOT EXISTS pricing_sheet_id VARCHAR(255);

-- Mở rộng danh sách quyền kho: thêm MANAGE_PRICING (nhập đơn giá) và
-- VIEW_PRICING (xem đơn giá + tổng giá đơn xuất), gán theo nhân sự + nhóm y hệt
-- các quyền kho khác — không phải "role kế toán" ở tầng hệ thống.
ALTER TABLE public.tk_warehouse_permissions
    DROP CONSTRAINT IF EXISTS tk_warehouse_permissions_code_check;
ALTER TABLE public.tk_warehouse_permissions
    ADD CONSTRAINT tk_warehouse_permissions_code_check CHECK (
        permission_code IN (
            'APPROVE_EXPORT',
            'AUTO_APPROVE_OWN_ORDER',
            'APPROVE_TRANSFER',
            'MANAGE_TEMPLATES',
            'MANAGE_PRODUCTS',
            'ADJUST_INVENTORY',
            'VIEW_REPORTS',
            'MANAGE_PRICING',
            'VIEW_PRICING'
        )
    );

COMMIT;
