-- v62: Nhật ký gửi tin nhắn cá nhân theo chỉ định (docs mục 28) — ghi ai gửi
-- cho ai, nội dung, outbox id và Telegram message id sau khi gửi thành công.

CREATE TABLE IF NOT EXISTS ai_management.direct_message_logs (
    id BIGSERIAL PRIMARY KEY,
    manager_id VARCHAR(64) NOT NULL,
    employee_id BIGINT,
    employee_code VARCHAR(50),
    employee_name VARCHAR(255),
    chat_id VARCHAR NOT NULL,
    text TEXT NOT NULL,
    outbox_id BIGINT,
    telegram_message_id BIGINT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_by_manager
    ON ai_management.direct_message_logs(manager_id, created_at DESC);
