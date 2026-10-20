-- v64: Lịch gửi báo cáo chấm công định kỳ cho quản lý.
CREATE TABLE IF NOT EXISTS ai_management.attendance_report_schedules (
    id BIGSERIAL PRIMARY KEY,
    manager_id VARCHAR(64) NOT NULL,
    telegram_chat_id VARCHAR(64) NOT NULL,
    group_id UUID NOT NULL REFERENCES public.telegram_groups(id) ON DELETE CASCADE,
    frequency VARCHAR(20) NOT NULL DEFAULT 'DAILY' CHECK (frequency IN ('DAILY')),
    local_time TIME NOT NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_sent_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_report_schedules_due
    ON ai_management.attendance_report_schedules (active, frequency, local_time, last_sent_on);
