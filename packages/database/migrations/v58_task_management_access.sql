-- v58: Module quản lý & giao việc (P1 — Access Code, RBAC)
-- Schema riêng `ai_management`; không sửa bảng nghiệp vụ cũ.
-- Tham khảo: docs/ke-hoach-he-thong-giao-viec-ai.md mục 23.4 và 4.2

CREATE SCHEMA IF NOT EXISTS ai_management;

-- Mã kích hoạt dùng một lần (database chỉ lưu hash, không lưu mã rõ)
CREATE TABLE IF NOT EXISTS ai_management.access_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_hash VARCHAR(64) NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'TEAM_LEAD')),
    scope JSONB NOT NULL DEFAULT '[]',
    expires_at TIMESTAMPTZ NOT NULL,
    max_attempts SMALLINT NOT NULL DEFAULT 5,
    attempt_count SMALLINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REDEEMED', 'CANCELLED')),
    bound_telegram_user_id VARCHAR,
    redeemed_by_telegram_user_id VARCHAR,
    redeemed_at TIMESTAMPTZ,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tài khoản quản lý: quyền gắn với Telegram numeric user ID
CREATE TABLE IF NOT EXISTS ai_management.manager_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id),
    telegram_user_id VARCHAR NOT NULL UNIQUE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('OWNER', 'MANAGER', 'TEAM_LEAD')),
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    granted_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Quyền độc lập gắn cho từng tài khoản quản lý
CREATE TABLE IF NOT EXISTS ai_management.manager_permissions (
    manager_account_id UUID NOT NULL
        REFERENCES ai_management.manager_accounts(id) ON DELETE CASCADE,
    permission VARCHAR(64) NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (manager_account_id, permission)
);

-- Phạm vi hoạt động: giới hạn theo nhóm Telegram hoặc nhân viên
CREATE TABLE IF NOT EXISTS ai_management.manager_scopes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manager_account_id UUID NOT NULL
        REFERENCES ai_management.manager_accounts(id) ON DELETE CASCADE,
    scope_type VARCHAR(20) NOT NULL
        CHECK (scope_type IN ('TELEGRAM_GROUP', 'EMPLOYEE')),
    scope_value VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (manager_account_id, scope_type, scope_value)
);

-- Nhật ký kiểm toán bất biến (append-only)
CREATE TABLE IF NOT EXISTS ai_management.audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_type VARCHAR(20) NOT NULL
        CHECK (actor_type IN ('ADMIN', 'MANAGER', 'EMPLOYEE', 'SYSTEM')),
    actor_id VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(40),
    entity_id VARCHAR(64),
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_access_codes_status
    ON ai_management.access_codes(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_manager_accounts_status
    ON ai_management.manager_accounts(status);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_created_at
    ON ai_management.audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_audit_log_actor
    ON ai_management.audit_log(actor_id, created_at DESC);
