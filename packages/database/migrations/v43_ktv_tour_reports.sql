BEGIN;

CREATE TABLE IF NOT EXISTS public.ktv_tour_reports (
    id SERIAL PRIMARY KEY,
    group_id VARCHAR(50) NOT NULL,
    message_id BIGINT,
    telegram_user_id BIGINT,
    reported_by VARCHAR(255),
    report_date DATE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    customer_type VARCHAR(50) DEFAULT 'Khách cũ',
    doctor VARCHAR(100),
    service TEXT,
    ktv_names TEXT[] NOT NULL DEFAULT '{}',
    tour_credit NUMERIC(4, 2) DEFAULT 1.0,
    appointment_id INTEGER REFERENCES public.customer_appointments(id) ON DELETE SET NULL,
    photo_file_id TEXT,
    photo_url TEXT,
    is_valid BOOLEAN DEFAULT TRUE,
    status VARCHAR(50) DEFAULT 'VALID',
    notes TEXT,
    missing_reason TEXT,
    raw_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ktv_tour_reports_group_date ON public.ktv_tour_reports(group_id, report_date);
CREATE INDEX IF NOT EXISTS idx_ktv_tour_reports_phone_date ON public.ktv_tour_reports(group_id, phone, report_date);
CREATE INDEX IF NOT EXISTS idx_ktv_tour_reports_user ON public.ktv_tour_reports(telegram_user_id, report_date);

COMMIT;
