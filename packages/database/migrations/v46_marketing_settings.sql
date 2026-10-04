-- Migration v46: Bổ sung cấu hình chi tiết cho Marketing Attendance
ALTER TABLE group_settings
    ADD COLUMN IF NOT EXISTS marketing_checkin_penalty NUMERIC DEFAULT 50000,
    ADD COLUMN IF NOT EXISTS marketing_checkout_penalty NUMERIC DEFAULT 20000,
    ADD COLUMN IF NOT EXISTS marketing_checkin_deadline TIME DEFAULT '08:30:00',
    ADD COLUMN IF NOT EXISTS marketing_late_cutoff TIME DEFAULT '09:30:00';
