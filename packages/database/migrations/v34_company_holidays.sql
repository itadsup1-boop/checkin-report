BEGIN;

CREATE TABLE IF NOT EXISTS public.company_holidays (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    note TEXT,
    announcement_time TIME NOT NULL DEFAULT TIME '08:00',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Bangkok',
    status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
    announcement_sent_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.admin_accounts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    CONSTRAINT company_holidays_valid_range CHECK (end_date >= start_date),
    CONSTRAINT company_holidays_valid_status CHECK (status IN ('SCHEDULED', 'CANCELLED'))
);

CREATE INDEX IF NOT EXISTS idx_company_holidays_active_dates
    ON public.company_holidays (start_date, end_date)
    WHERE status = 'SCHEDULED';

CREATE TABLE IF NOT EXISTS public.company_holiday_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    holiday_id UUID NOT NULL REFERENCES public.company_holidays(id) ON DELETE CASCADE,
    telegram_group_id VARCHAR NOT NULL REFERENCES public.telegram_groups(telegram_group_id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    telegram_message_id VARCHAR(100),
    error_message TEXT,
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (holiday_id, telegram_group_id),
    CONSTRAINT company_holiday_notifications_status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);

COMMIT;
