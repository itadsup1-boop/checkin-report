BEGIN;

CREATE TABLE IF NOT EXISTS public.retail_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.telegram_groups(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    store_name VARCHAR(255) NOT NULL,
    store_address TEXT,
    selfie_photo_url TEXT,
    store_photo_url TEXT,
    media_urls JSONB DEFAULT '[]'::jsonb,
    checkin_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
    is_valid BOOLEAN NOT NULL DEFAULT TRUE,
    reject_reason TEXT,
    photo_hashes TEXT[] DEFAULT ARRAY[]::TEXT[],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retail_checkins_emp_date
    ON public.retail_checkins (employee_id, checkin_date);

CREATE INDEX IF NOT EXISTS idx_retail_checkins_group_date
    ON public.retail_checkins (group_id, checkin_date);

CREATE TABLE IF NOT EXISTS public.retail_daily_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES public.telegram_groups(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    record_date DATE NOT NULL,
    valid_points_count INTEGER NOT NULL DEFAULT 0,
    target_points INTEGER NOT NULL DEFAULT 15,
    is_completed BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(50) NOT NULL DEFAULT 'INCOMPLETE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_retail_daily_summary UNIQUE (employee_id, record_date, group_id)
);

CREATE INDEX IF NOT EXISTS idx_retail_daily_summaries_date
    ON public.retail_daily_summaries (record_date);

COMMIT;
