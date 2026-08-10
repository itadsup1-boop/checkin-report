CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. admins
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR UNIQUE NOT NULL,
    password_hash VARCHAR NOT NULL,
    role VARCHAR NOT NULL, -- ADMIN, HR, ACCOUNTANT
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. telegram_groups
CREATE TABLE IF NOT EXISTS telegram_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR UNIQUE NOT NULL,
    group_name VARCHAR NOT NULL,
    report_keyword VARCHAR DEFAULT '#baocao',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. group_settings
CREATE TABLE IF NOT EXISTS group_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    main_kpi_unit VARCHAR DEFAULT 'khách',
    remind_time_1 TIME,
    remind_time_2 TIME,
    remind_time_3 TIME,
    deadline_time TIME,
    auto_reminder_enabled BOOLEAN DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. employees
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_code VARCHAR UNIQUE NOT NULL,
    full_name VARCHAR NOT NULL,
    telegram_id VARCHAR,
    telegram_username VARCHAR,
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    department VARCHAR NOT NULL,
    position VARCHAR NOT NULL,
    need_report BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. kpi_policies
CREATE TABLE IF NOT EXISTS kpi_policies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    department VARCHAR NOT NULL,
    position VARCHAR NOT NULL,
    kpi_name VARCHAR NOT NULL,
    kpi_required NUMERIC NOT NULL,
    kpi_unit VARCHAR NOT NULL,
    penalty_low_kpi NUMERIC DEFAULT 0,
    penalty_missing_report NUMERIC DEFAULT 0,
    penalty_late_report NUMERIC DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. employee_kpi_overrides
CREATE TABLE IF NOT EXISTS employee_kpi_overrides (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID REFERENCES employees(id),
    kpi_name VARCHAR NOT NULL,
    kpi_required NUMERIC NOT NULL,
    kpi_unit VARCHAR NOT NULL,
    penalty_low_kpi NUMERIC DEFAULT 0,
    penalty_missing_report NUMERIC DEFAULT 0,
    penalty_late_report NUMERIC DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. daily_reports
CREATE TABLE IF NOT EXISTS daily_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_date DATE NOT NULL,
    report_month VARCHAR NOT NULL, -- format YYYY-MM
    employee_id UUID REFERENCES employees(id),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    raw_text TEXT,
    parsed_json JSONB,
    kpi_required NUMERIC,
    kpi_actual NUMERIC,
    kpi_unit VARCHAR,
    kpi_missing NUMERIC,
    completion_rate NUMERIC,
    status VARCHAR, -- DAT_KPI, KHONG_DAT_KPI, THIEU_FORM, CHUA_BAO_CAO, BAO_CAO_MUON
    submitted_at TIMESTAMP WITH TIME ZONE,
    is_late BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. penalty_records
CREATE TABLE IF NOT EXISTS penalty_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_date DATE NOT NULL,
    report_month VARCHAR NOT NULL,
    employee_id UUID REFERENCES employees(id),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    reason VARCHAR NOT NULL,
    kpi_required NUMERIC,
    kpi_actual NUMERIC,
    kpi_missing NUMERIC,
    amount NUMERIC DEFAULT 0,
    status VARCHAR DEFAULT 'CHO_DUYET', -- CHO_DUYET, DA_DUYET, DA_HUY, DA_GUI_KE_TOAN
    accounting_sheet_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. reminder_logs
CREATE TABLE IF NOT EXISTS reminder_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    report_date DATE NOT NULL,
    employee_id UUID REFERENCES employees(id),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id),
    reminder_no INTEGER, -- 1, 2, 3
    send_type VARCHAR, -- AUTO, MANUAL_ADMIN
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. tour_makeup_requests
CREATE TABLE IF NOT EXISTS tour_makeup_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id) ON DELETE CASCADE,
    telegram_id VARCHAR NOT NULL,
    employee_name VARCHAR NOT NULL,
    request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('EXISTING_APPOINTMENT', 'MISSING_APPOINTMENT')),
    original_appointment_id INTEGER REFERENCES customer_appointments(id) ON DELETE SET NULL,
    work_date DATE NOT NULL,
    appointment_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    service VARCHAR(255) NOT NULL,
    sessions VARCHAR(50) NOT NULL,
    session_type VARCHAR(50) NOT NULL DEFAULT 'Bán',
    revenue VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    proof_image TEXT NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING_NOTIFICATION', 'PENDING', 'APPROVED', 'REJECTED', 'NOTIFICATION_FAILED')),
    sheet_sync_status VARCHAR(50) DEFAULT 'NOT_STARTED',
    sheet_sync_error TEXT,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    reviewed_by VARCHAR(255),
    review_note TEXT,
    approved_appointment_id INTEGER REFERENCES customer_appointments(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tour_makeup_group ON tour_makeup_requests(telegram_group_id);
CREATE INDEX IF NOT EXISTS idx_tour_makeup_employee ON tour_makeup_requests(telegram_id);
CREATE INDEX IF NOT EXISTS idx_tour_makeup_status ON tour_makeup_requests(status);
CREATE INDEX IF NOT EXISTS idx_tour_makeup_work_date ON tour_makeup_requests(work_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tour_makeup_dedupe ON tour_makeup_requests(telegram_id, telegram_group_id, work_date, customer_phone) WHERE status IN ('PENDING_NOTIFICATION', 'PENDING', 'APPROVED', 'NOTIFICATION_FAILED');

