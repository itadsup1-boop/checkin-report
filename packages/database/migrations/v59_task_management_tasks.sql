-- v59: Module quản lý & giao việc (P2 — nhiệm vụ, duyệt, nhắc, outbox)
-- Tham khảo: docs/ke-hoach-he-thong-giao-viec-ai.md mục 5, 6, 10

CREATE SEQUENCE IF NOT EXISTS ai_management.task_display_code_seq START 101;

-- Nhiệm vụ: 1 bản chung cho nhiều người, trạng thái chi tiết nằm ở task_assignees
CREATE TABLE IF NOT EXISTS ai_management.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    display_code BIGINT NOT NULL DEFAULT nextval('ai_management.task_display_code_seq') UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'CANCELLED')),
    priority VARCHAR(10) NOT NULL DEFAULT 'NORMAL'
        CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
    reminder_mode VARCHAR(30) NOT NULL DEFAULT 'ONCE_BEFORE_DUE'
        CHECK (reminder_mode IN ('ONCE_BEFORE_DUE', 'DAILY_AFTER_CHECKIN')),
    starts_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ NOT NULL,
    created_by VARCHAR(64) NOT NULL,
    cancelled_reason TEXT,
    cancelled_by VARCHAR(64),
    cancelled_at TIMESTAMPTZ,
    idempotency_key VARCHAR(80) UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trạng thái nhận/làm/xong riêng từng người (mục 21: 1 bản chung, tick riêng)
CREATE TABLE IF NOT EXISTS ai_management.task_assignees (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES ai_management.tasks(id) ON DELETE CASCADE,
    employee_id UUID,
    employee_code_snapshot VARCHAR,
    employee_name_snapshot VARCHAR,
    telegram_user_id_snapshot VARCHAR NOT NULL,
    assignment_status VARCHAR(30) NOT NULL DEFAULT 'ASSIGNED'
        CHECK (assignment_status IN
            ('ASSIGNED', 'ACCEPTED', 'DECLINED', 'DONE_PENDING_REVIEW', 'DONE')),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(64),
    review_note TEXT,
    -- Cột chống nhắc trùng (thay bảng reminders riêng cho MVP)
    not_accepted_reminded_at TIMESTAMPTZ,
    before_due_reminded_due_at TIMESTAMPTZ,
    overdue_reminded_at TIMESTAMPTZ,
    overdue_manager_notified_at TIMESTAMPTZ,
    last_daily_reminded_on DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, telegram_user_id_snapshot)
);

-- Nhật ký bất biến (append-only)
CREATE TABLE IF NOT EXISTS ai_management.task_events (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES ai_management.tasks(id) ON DELETE CASCADE,
    assignee_id BIGINT,
    event_type VARCHAR(30) NOT NULL,
    actor_type VARCHAR(20) NOT NULL
        CHECK (actor_type IN ('MANAGER', 'EMPLOYEE', 'ADMIN', 'SYSTEM')),
    actor_id VARCHAR(64) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Yêu cầu gia hạn chờ người giao duyệt
CREATE TABLE IF NOT EXISTS ai_management.extend_requests (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES ai_management.tasks(id) ON DELETE CASCADE,
    assignee_id BIGINT NOT NULL,
    proposed_due_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    requested_by VARCHAR(64) NOT NULL,
    decided_by VARCHAR(64),
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Transactional outbox: gửi Telegram đúng một lần, retry an toàn
CREATE TABLE IF NOT EXISTS ai_management.notification_outbox (
    id BIGSERIAL PRIMARY KEY,
    deduplication_key VARCHAR(150) NOT NULL UNIQUE,
    channel VARCHAR(20) NOT NULL DEFAULT 'telegram',
    chat_id VARCHAR NOT NULL,
    text TEXT NOT NULL,
    reply_markup JSONB,
    link_meta JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
    attempt_count SMALLINT NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Gắn tin nhắn Telegram với task để định tuyến reply (phản hồi hai chiều)
CREATE TABLE IF NOT EXISTS ai_management.task_message_links (
    id BIGSERIAL PRIMARY KEY,
    chat_id VARCHAR NOT NULL,
    message_id BIGINT NOT NULL,
    task_id UUID NOT NULL REFERENCES ai_management.tasks(id) ON DELETE CASCADE,
    assignee_id BIGINT,
    direction VARCHAR(20) NOT NULL
        CHECK (direction IN
            ('EMPLOYEE_TASK', 'MANAGER_REVIEW', 'MANAGER_COMMENT', 'EMPLOYEE_COMMENT')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_tasks_due ON ai_management.tasks(status, due_at);
CREATE INDEX IF NOT EXISTS idx_ai_tasks_created_by ON ai_management.tasks(created_by, status);
CREATE INDEX IF NOT EXISTS idx_ai_assignees_open
    ON ai_management.task_assignees(assignment_status)
    WHERE assignment_status IN ('ASSIGNED', 'ACCEPTED', 'DONE_PENDING_REVIEW');
CREATE INDEX IF NOT EXISTS idx_ai_events_task
    ON ai_management.task_events(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_outbox_pending
    ON ai_management.notification_outbox(status, available_at);
CREATE INDEX IF NOT EXISTS idx_ai_extend_requests_status
    ON ai_management.extend_requests(status);
