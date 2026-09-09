BEGIN;

ALTER TABLE tk_attendance_daily_status
    ADD COLUMN IF NOT EXISTS absence_notified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tk_penalties_one_type_per_day
    ON tk_penalties(group_id, user_id, date, violation_type);

COMMENT ON COLUMN tk_attendance_daily_status.absence_notified_at IS
    'Thời điểm nhóm đã nhận thông báo không check-in lúc 14:00; dùng chống gửi trùng.';

COMMIT;
