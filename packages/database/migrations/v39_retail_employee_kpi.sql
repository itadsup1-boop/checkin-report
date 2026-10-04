-- v39: Bảng cấu hình KPI cá nhân cho nhân viên check-in thị trường (Retail)
-- Cho phép Quản lý cài đặt chỉ tiêu riêng cho từng thành viên trong từng nhóm.
-- Nếu không cài đặt (hoặc chưa có bản ghi), hệ thống tự động fallback về KPI mặc định của nhóm (15 điểm).

BEGIN;

CREATE TABLE IF NOT EXISTS public.retail_employee_kpi (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id       UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    telegram_group_id VARCHAR(50) NOT NULL REFERENCES public.telegram_groups(telegram_group_id) ON DELETE CASCADE,
    daily_kpi_target  INTEGER NOT NULL CHECK (daily_kpi_target > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_retail_employee_kpi UNIQUE (employee_id, telegram_group_id)
);

CREATE INDEX IF NOT EXISTS idx_retail_employee_kpi_lookup
    ON public.retail_employee_kpi (employee_id, telegram_group_id);

COMMENT ON TABLE public.retail_employee_kpi IS
    'Lưu trữ chỉ tiêu KPI check-in điểm bán/ngày cá nhân hóa cho từng nhân viên theo từng nhóm tuyến.';

COMMIT;
