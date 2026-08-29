BEGIN;

-- Đơn cũ được giữ nguyên bằng NULL. API yêu cầu hai trường này với mọi đơn mới;
-- constraint chỉ ngăn chuỗi rỗng lọt vào khi có giá trị.
ALTER TABLE public.tk_warehouse_orders
    ADD COLUMN IF NOT EXISTS doctor_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS technician_name VARCHAR(255);

ALTER TABLE public.tk_warehouse_orders
    DROP CONSTRAINT IF EXISTS tk_warehouse_orders_doctor_name_not_blank,
    DROP CONSTRAINT IF EXISTS tk_warehouse_orders_technician_name_not_blank;

ALTER TABLE public.tk_warehouse_orders
    ADD CONSTRAINT tk_warehouse_orders_doctor_name_not_blank
        CHECK (doctor_name IS NULL OR BTRIM(doctor_name) <> ''),
    ADD CONSTRAINT tk_warehouse_orders_technician_name_not_blank
        CHECK (technician_name IS NULL OR BTRIM(technician_name) <> '');

COMMIT;
