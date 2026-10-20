BEGIN;

CREATE TABLE IF NOT EXISTS public.uk_tour_records (
    id SERIAL PRIMARY KEY,
    stt INTEGER NOT NULL,
    record_date DATE NOT NULL,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    customer_type VARCHAR(50) DEFAULT 'Cũ',
    customer_name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    service TEXT,
    sessions VARCHAR(100),
    bill VARCHAR(100),
    bill_amount NUMERIC(15, 2) DEFAULT 0,
    notes TEXT,
    ktv VARCHAR(100),
    ktv1 VARCHAR(50),
    ktv2 VARCHAR(50),
    doctor VARCHAR(100),
    so_ktv INTEGER DEFAULT 1,
    cong_tua NUMERIC(15, 2) DEFAULT 0,
    cong_ty NUMERIC(15, 2) DEFAULT 0,
    my NUMERIC(15, 2) DEFAULT 0,
    my_linh NUMERIC(15, 2) DEFAULT 0,
    nhung NUMERIC(15, 2) DEFAULT 0,
    linh NUMERIC(15, 2) DEFAULT 0,
    ngan NUMERIC(15, 2) DEFAULT 0,
    hue NUMERIC(15, 2) DEFAULT 0,
    x_val NUMERIC(15, 2) DEFAULT 0,
    tong NUMERIC(15, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uk_tour_records_month_year ON public.uk_tour_records(year, month, stt);
CREATE INDEX IF NOT EXISTS idx_uk_tour_records_date ON public.uk_tour_records(record_date);
CREATE INDEX IF NOT EXISTS idx_uk_tour_records_phone ON public.uk_tour_records(phone);

COMMIT;
