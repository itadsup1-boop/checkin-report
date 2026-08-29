CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS telegram_user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(100) NOT NULL,
    phone_masked VARCHAR(32) NOT NULL,
    phone_encrypted TEXT NOT NULL,
    session_encrypted TEXT,
    phone_code_hash_encrypted TEXT,
    telegram_user_id TEXT,
    telegram_username VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING_CODE',
    last_error TEXT,
    last_synced_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES admin_accounts(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_managed_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES telegram_user_accounts(id) ON DELETE CASCADE,
    telegram_group_id TEXT NOT NULL,
    title TEXT NOT NULL,
    group_type VARCHAR(20) NOT NULL,
    member_count INTEGER,
    is_owner BOOLEAN NOT NULL DEFAULT FALSE,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete_messages BOOLEAN NOT NULL DEFAULT FALSE,
    can_restrict_members BOOLEAN NOT NULL DEFAULT FALSE,
    can_delete_group BOOLEAN NOT NULL DEFAULT FALSE,
    is_visible BOOLEAN NOT NULL DEFAULT TRUE,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(account_id, telegram_group_id)
);

CREATE TABLE IF NOT EXISTS admin_destructive_credentials (
    admin_id UUID PRIMARY KEY REFERENCES admin_accounts(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telegram_destructive_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES telegram_user_accounts(id),
    requested_by UUID NOT NULL REFERENCES admin_accounts(id),
    requested_action VARCHAR(20) NOT NULL CHECK (requested_action IN ('RESET', 'DELETE')),
    status VARCHAR(30) NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    confirmation_phrase VARCHAR(120) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    total_groups INTEGER NOT NULL,
    completed_groups INTEGER NOT NULL DEFAULT 0,
    failed_groups INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS telegram_operation_groups (
    operation_id UUID NOT NULL REFERENCES telegram_destructive_operations(id) ON DELETE CASCADE,
    managed_group_id UUID NOT NULL REFERENCES telegram_managed_groups(id),
    title_snapshot TEXT NOT NULL,
    resolved_action VARCHAR(20) NOT NULL CHECK (resolved_action IN ('RESET', 'DELETE')),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    removed_members INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    PRIMARY KEY(operation_id, managed_group_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_operations_status ON telegram_destructive_operations(status, created_at);
CREATE INDEX IF NOT EXISTS idx_telegram_groups_account ON telegram_managed_groups(account_id, title);
