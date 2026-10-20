-- v38: Thêm cột start_date vào retail_checkin_config để cấu hình ngày bắt đầu áp dụng cơ chế check-in điểm bán
BEGIN;

ALTER TABLE public.retail_checkin_config 
ADD COLUMN IF NOT EXISTS start_date DATE DEFAULT CURRENT_DATE;

COMMENT ON COLUMN public.retail_checkin_config.start_date IS 
'Ngày chính thức áp dụng cơ chế check-in, nhắc nhở và chốt sổ KPI cho nhóm.';

COMMIT;
