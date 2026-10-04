-- Migration v45: Bổ sung cấu hình Chấm công Marketing và các cột Check-out / Ngày công

-- 1. Bổ sung cấu hình Policy vào bảng group_settings
ALTER TABLE group_settings
    ADD COLUMN IF NOT EXISTS attendance_policy VARCHAR(30) DEFAULT 'CLINIC',
    ADD COLUMN IF NOT EXISTS checkout_min_time TIME DEFAULT '18:30:00',
    ADD COLUMN IF NOT EXISTS checkout_deadline TIME DEFAULT '22:00:00';

-- Đảm bảo tất cả các nhóm hiện hành mặc định có policy là CLINIC
UPDATE group_settings
SET attendance_policy = 'CLINIC'
WHERE attendance_policy IS NULL;

-- 2. Bổ sung các cột Check-out và Ngày công vào bảng tk_check_ins
ALTER TABLE tk_check_ins
    ADD COLUMN IF NOT EXISTS checkout_time TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS checkout_media_file_id VARCHAR,
    ADD COLUMN IF NOT EXISTS checkout_status VARCHAR(30) DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS work_credit NUMERIC(3,2) DEFAULT 1.0,
    ADD COLUMN IF NOT EXISTS checkin_penalty_amount INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS checkout_penalty_amount INTEGER DEFAULT 0;

-- 3. Tạo index phục vụ tra cứu và quét cron
CREATE INDEX IF NOT EXISTS idx_tk_check_ins_checkout ON tk_check_ins(date, checkout_status);
CREATE INDEX IF NOT EXISTS idx_group_settings_policy ON group_settings(attendance_policy);
