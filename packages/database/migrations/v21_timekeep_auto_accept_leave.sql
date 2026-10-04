BEGIN;

ALTER TABLE tk_leave_requests
    ADD COLUMN IF NOT EXISTS auto_accepted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS effective_applied_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS previous_schedule JSONB;

COMMENT ON COLUMN tk_leave_requests.auto_accepted IS
    'TRUE khi đơn nghỉ/đi muộn có hiệu lực ngay sau khi nhân viên gửi; quản lý chỉ cần từ chối nếu không đồng ý.';

COMMENT ON COLUMN tk_leave_requests.previous_schedule IS
    'Ảnh chụp lịch trước khi tự chấp nhận đơn, dùng để khôi phục chính xác khi quản lý từ chối.';

COMMIT;
