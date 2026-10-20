BEGIN;

CREATE TABLE IF NOT EXISTS public.telesale_daily_reports (
    id SERIAL PRIMARY KEY,
    telegram_group_id VARCHAR(50) NOT NULL,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    telegram_user_id BIGINT,
    employee_name VARCHAR(255),
    report_date DATE NOT NULL,
    so_nhan INTEGER DEFAULT 0,
    so_trung_knc_vang INTEGER DEFAULT 0,
    lich_pv_moi INTEGER DEFAULT 0,
    lich_pv_cu INTEGER DEFAULT 0,
    lich_ngay_mai INTEGER DEFAULT 0,
    tong_toi_hnay INTEGER DEFAULT 0,
    tong_bong_hnay INTEGER DEFAULT 0,
    tong_ds_hnay NUMERIC(15, 2) DEFAULT 0,
    tong_lich INTEGER DEFAULT 0,
    tong_ds_thang NUMERIC(15, 2) DEFAULT 0,
    ty_le_khach_toi_ds NUMERIC(15, 2) DEFAULT 0,
    ty_le_lich NUMERIC(5, 2) DEFAULT 0,
    ty_le_toi NUMERIC(5, 2) DEFAULT 0,
    raw_payload JSONB DEFAULT '{}',
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(telegram_group_id, employee_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_telesale_reports_group_date ON public.telesale_daily_reports(telegram_group_id, report_date);
CREATE INDEX IF NOT EXISTS idx_telesale_reports_emp_date ON public.telesale_daily_reports(employee_id, report_date);

COMMIT;
