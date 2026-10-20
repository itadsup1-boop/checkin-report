BEGIN;

-- 1. Thêm cột mốc giờ, dự án, dịch vụ vào telesale_daily_reports
ALTER TABLE public.telesale_daily_reports
ADD COLUMN IF NOT EXISTS report_slot VARCHAR(50) DEFAULT 'DAILY',
ADD COLUMN IF NOT EXISTS project_name VARCHAR(255) DEFAULT '',
ADD COLUMN IF NOT EXISTS service_name VARCHAR(255) DEFAULT '';

-- Cập nhật các bản ghi cũ nếu có giá trị null
UPDATE public.telesale_daily_reports
SET report_slot = 'DAILY'
WHERE report_slot IS NULL;

UPDATE public.telesale_daily_reports
SET project_name = ''
WHERE project_name IS NULL;

UPDATE public.telesale_daily_reports
SET service_name = ''
WHERE service_name IS NULL;

-- 2. Đổi ràng buộc UNIQUE để cho phép nộp nhiều mốc giờ và nhiều dự án/dịch vụ
ALTER TABLE public.telesale_daily_reports
DROP CONSTRAINT IF EXISTS telesale_daily_reports_telegram_group_id_employee_id_report_key;

ALTER TABLE public.telesale_daily_reports
DROP CONSTRAINT IF EXISTS telesale_daily_reports_unique_entry;

ALTER TABLE public.telesale_daily_reports
ADD CONSTRAINT telesale_daily_reports_unique_entry 
UNIQUE (telegram_group_id, employee_id, report_date, report_slot, project_name, service_name);

-- Index phụ trợ tìm kiếm theo mốc giờ và dự án/dịch vụ
CREATE INDEX IF NOT EXISTS idx_telesale_reports_slot ON public.telesale_daily_reports(telegram_group_id, report_date, report_slot);
CREATE INDEX IF NOT EXISTS idx_telesale_reports_service ON public.telesale_daily_reports(telegram_group_id, report_date, service_name);

-- 3. Bổ sung các cột tính năng động vào bảng telesale_form_configs
ALTER TABLE public.telesale_form_configs
ADD COLUMN IF NOT EXISTS features JSONB DEFAULT '{"has_projects": false, "has_services": false, "schedule_mode": "SINGLE_SLOT", "summary_template": "BY_EMPLOYEE", "cumulative_mode": "MONTHLY"}'::jsonb,
ADD COLUMN IF NOT EXISTS projects JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS services JSONB DEFAULT '[]'::jsonb;

COMMIT;
