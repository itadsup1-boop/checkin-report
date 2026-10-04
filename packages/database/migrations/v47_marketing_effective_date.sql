-- Migration v47: Add effective_start_date to group_settings and set for Marketing groups

ALTER TABLE group_settings
    ADD COLUMN IF NOT EXISTS effective_start_date DATE DEFAULT '2026-09-26';

UPDATE group_settings
SET effective_start_date = '2026-09-26',
    marketing_checkin_deadline = '08:30:00',
    marketing_late_cutoff = '09:30:00',
    marketing_checkin_penalty = 50000,
    checkout_min_time = '18:30:00',
    checkout_deadline = '22:00:00',
    marketing_checkout_penalty = 20000
WHERE telegram_group_id = '-5470063387';
