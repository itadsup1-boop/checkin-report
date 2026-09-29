BEGIN;

-- Thêm cấu hình chế độ phê duyệt (Tự động duyệt 'AUTO' / Yêu cầu duyệt 'MANUAL') theo từng nhóm
ALTER TABLE public.telegram_groups
    ADD COLUMN IF NOT EXISTS approval_settings JSONB NOT NULL DEFAULT '{
        "leave_late": "AUTO",
        "leave_absence": "AUTO",
        "staff_registration": "AUTO",
        "warehouse_order": "AUTO",
        "tour_report": "AUTO",
        "schedule_change": "AUTO"
    }'::jsonb;

-- Cập nhật tất cả các nhóm hiện có về mặc định tự động duyệt (AUTO) theo chỉ đạo của Admin
UPDATE public.telegram_groups
SET approval_settings = '{
    "leave_late": "AUTO",
    "leave_absence": "AUTO",
    "staff_registration": "AUTO",
    "warehouse_order": "AUTO",
    "tour_report": "AUTO",
    "schedule_change": "AUTO"
}'::jsonb;

COMMIT;
