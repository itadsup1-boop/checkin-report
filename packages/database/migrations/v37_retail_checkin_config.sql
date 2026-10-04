-- v37: Bảng cấu hình riêng cho module Check-in điểm bán (Retail).
-- Mỗi nhóm Telegram có role retail_checkin có thể tự cấu hình:
--   shift_start_time : Giờ bắt đầu ca làm việc
--   shift_end_time   : Giờ kết thúc ca (dùng để tính lịch nhắc tự động)
--   daily_kpi_target : Số điểm check-in cần đạt trong ngày

BEGIN;

CREATE TABLE IF NOT EXISTS public.retail_checkin_config (
    id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_group_id VARCHAR(50) NOT NULL UNIQUE
        REFERENCES public.telegram_groups(telegram_group_id) ON DELETE CASCADE,
    shift_start_time  TIME    NOT NULL DEFAULT '08:00',
    shift_end_time    TIME    NOT NULL DEFAULT '18:00',
    daily_kpi_target  INTEGER NOT NULL DEFAULT 15 CHECK (daily_kpi_target > 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.retail_checkin_config IS
    'Cấu hình ca làm việc và KPI tối đa/ngày cho từng nhóm Retail Check-in.';

COMMIT;
