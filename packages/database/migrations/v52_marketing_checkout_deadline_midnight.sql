-- Migration v52: Update checkout_deadline to 23:59:00 (12h midnight / end of day)
-- and update effective_start_date to 2026-09-29

ALTER TABLE group_settings
    ALTER COLUMN checkout_deadline SET DEFAULT '23:59:00';

ALTER TABLE group_settings
    ALTER COLUMN effective_start_date SET DEFAULT '2026-09-29';

UPDATE group_settings
SET checkout_deadline = '23:59:00';

UPDATE group_settings
SET effective_start_date = '2026-09-29'
WHERE attendance_policy = 'MARKETING';

-- Huỷ các khoản phạt quét nhầm lúc 22:00 ngày 28/09/2026
DELETE FROM tk_penalties
WHERE date = '2026-09-28'
  AND violation_type = 'MISSED_CHECKOUT';

UPDATE tk_check_ins
SET checkout_status = NULL,
    checkout_penalty_amount = 0
WHERE date = '2026-09-28'
  AND checkout_status = 'QUEN_CHECKOUT';
