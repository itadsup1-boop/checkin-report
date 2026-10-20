-- v63: Cấu hình ngưỡng nhắc việc theo từng quản lý (docs mục 29) — deterministic,
-- mỗi quản lý chỉnh ngưỡng cho automation của chính mình + nút tạm dừng.
-- Mặc định trùng giá trị hardcode trước đây (30 phút trước hạn, 15 phút chưa nhận,
-- 2 giờ quá hạn báo người giao, form 24 giờ / 2 giờ).

CREATE TABLE IF NOT EXISTS ai_management.manager_rule_configs (
    manager_id VARCHAR(64) PRIMARY KEY,
    due_soon_minutes INT NOT NULL DEFAULT 30 CHECK (due_soon_minutes BETWEEN 5 AND 720),
    not_accepted_minutes INT NOT NULL DEFAULT 15 CHECK (not_accepted_minutes BETWEEN 5 AND 120),
    overdue_manager_hours INT NOT NULL DEFAULT 2 CHECK (overdue_manager_hours BETWEEN 1 AND 72),
    form_due_soon_hours INT NOT NULL DEFAULT 24 CHECK (form_due_soon_hours BETWEEN 1 AND 168),
    form_overdue_manager_hours INT NOT NULL DEFAULT 2 CHECK (form_overdue_manager_hours BETWEEN 1 AND 72),
    paused BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
