BEGIN;

-- 1. Bảng cấu hình Form động cho từng nhóm Telesale
CREATE TABLE IF NOT EXISTS public.telesale_form_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_group_id VARCHAR(50) NOT NULL UNIQUE,
    group_name VARCHAR(255),
    fields JSONB NOT NULL DEFAULT '[]',
    schedule_settings JSONB NOT NULL DEFAULT '{
        "remind_enabled": true,
        "remind_time": "18:00",
        "deadline_time": "19:00",
        "penalty_enabled": true,
        "penalty_amount": 50000,
        "summary_enabled": true,
        "summary_time": "19:01",
        "summary_fields": []
    }',
    sheet_settings JSONB NOT NULL DEFAULT '{
        "auto_sync_headers": true
    }',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telesale_form_configs_group ON public.telesale_form_configs(telegram_group_id);

-- 2. Bổ sung cột report_values JSONB vào telesale_daily_reports nếu chưa có
ALTER TABLE public.telesale_daily_reports 
ADD COLUMN IF NOT EXISTS report_values JSONB DEFAULT '{}';

COMMIT;
