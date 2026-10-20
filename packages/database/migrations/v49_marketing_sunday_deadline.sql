-- Migration v49: Bo sung cau hinh gio check-in Chu Nhat cho Marketing
ALTER TABLE group_settings
    ADD COLUMN IF NOT EXISTS marketing_sunday_checkin_deadline TIME DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS marketing_sunday_late_cutoff TIME DEFAULT NULL;

-- Cap nhat rieng cho nhom 00. Check in Adsup (-5470063387)
UPDATE group_settings
SET marketing_sunday_checkin_deadline = '09:00:00',
    marketing_sunday_late_cutoff = '10:00:00'
WHERE telegram_group_id = '-5470063387';
