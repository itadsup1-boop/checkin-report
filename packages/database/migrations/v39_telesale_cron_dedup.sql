-- Migration v39: Bảng chống trùng lặp tin nhắn cron telesale (nhắc nhở, phạt, tổng kết)
CREATE TABLE IF NOT EXISTS telesale_cron_dedup (
    dedup_key VARCHAR(150) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telesale_cron_dedup_created_at ON telesale_cron_dedup(created_at);
