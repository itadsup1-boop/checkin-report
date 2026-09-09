BEGIN;

-- Mọi tài khoản Telegram mới chỉ tạo yêu cầu chờ ở các cột pending_*.
-- Admin phải chọn đúng hồ sơ rồi duyệt trước khi telegram_id được gắn thật.
-- Chặn kiểu tấn công: biết tên đồng nghiệp rồi tự đăng ký trước để chiếm hồ sơ.
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS pending_telegram_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS pending_telegram_username VARCHAR(255),
    ADD COLUMN IF NOT EXISTS pending_role VARCHAR(100),
    -- Chỉ nhánh nhóm KPI cần cột này (nhóm gắn qua bảng membership riêng,
    -- không nằm ở employees.telegram_group_id) — để lúc Admin duyệt biết
    -- đăng ký này thuộc nhóm KPI nào mà hoàn tất việc tạo membership.
    ADD COLUMN IF NOT EXISTS pending_telegram_group_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS pending_requested_at TIMESTAMPTZ,
    -- TRUE khi hệ thống phải tạo một hồ sơ tạm vì chưa có hồ sơ Admin phù hợp.
    -- Nếu Admin từ chối thì hồ sơ tạm này được xóa, hồ sơ tạo sẵn thì giữ nguyên.
    ADD COLUMN IF NOT EXISTS pending_is_new_profile BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_pending_telegram_group
    ON public.employees (pending_telegram_id, pending_telegram_group_id)
    WHERE pending_telegram_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employees_pending_requested_at
    ON public.employees (pending_requested_at)
    WHERE pending_telegram_id IS NOT NULL;

COMMIT;
