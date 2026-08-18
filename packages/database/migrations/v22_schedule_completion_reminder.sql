BEGIN;

ALTER TABLE customer_appointments
    ADD COLUMN IF NOT EXISTS completion_reminded_at TIMESTAMP;

-- Không phát thông báo ngược cho lịch đã tồn tại trước lúc bật tính năng.
UPDATE customer_appointments
SET completion_reminded_at = NOW()
WHERE completion_reminded_at IS NULL
  AND appointment_time < NOW();

CREATE INDEX IF NOT EXISTS idx_customer_appointments_completion_reminder
    ON customer_appointments (appointment_time)
    WHERE completion_reminded_at IS NULL
      AND status IN ('ACTIVE', 'ARRIVED');

COMMIT;
