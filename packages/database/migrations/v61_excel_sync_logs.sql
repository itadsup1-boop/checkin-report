-- v61: Lịch sử đồng bộ Excel cho module quản lý (docs mục 27: lưu lịch sử
-- sync, checksum file và người thực hiện).

CREATE TABLE IF NOT EXISTS ai_management.excel_sync_logs (
    id BIGSERIAL PRIMARY KEY,
    entity VARCHAR(30) NOT NULL CHECK (entity IN ('TASK')),
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('DRY_RUN', 'COMMIT')),
    file_name VARCHAR(255),
    file_checksum VARCHAR(64) NOT NULL,
    rows_total INTEGER NOT NULL DEFAULT 0,
    rows_ok INTEGER NOT NULL DEFAULT 0,
    rows_error INTEGER NOT NULL DEFAULT 0,
    rows_conflict INTEGER NOT NULL DEFAULT 0,
    mapping JSONB,
    row_errors JSONB,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_excel_sync_by_user
    ON ai_management.excel_sync_logs(created_by, created_at DESC);
