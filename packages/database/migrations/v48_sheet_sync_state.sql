-- v48: bảng lưu hash nội dung đã đồng bộ lên Google Sheets.
-- Dùng để bỏ qua lệnh ghi khi dữ liệu không thay đổi (giảm quota Google Sheets).
CREATE TABLE IF NOT EXISTS sheet_sync_state (
    sheet_key TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
