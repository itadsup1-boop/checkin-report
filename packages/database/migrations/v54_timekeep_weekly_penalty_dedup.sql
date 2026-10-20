-- Migration v54: Bảng chống gửi trùng tin tổng kết phạt chấm công tuần (tối Chủ nhật)
CREATE TABLE IF NOT EXISTS timekeep_cron_dedup (
    dedup_key VARCHAR(150) PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timekeep_cron_dedup_created_at ON timekeep_cron_dedup(created_at);
