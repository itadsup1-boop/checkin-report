CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. tk_groups (Quản lý các Nhóm Telegram)
CREATE TABLE IF NOT EXISTS tk_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    telegram_group_id VARCHAR UNIQUE NOT NULL,
    group_name VARCHAR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. tk_users (Nhân sự)
CREATE TABLE IF NOT EXISTS tk_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES tk_groups(id) ON DELETE CASCADE,
    telegram_id VARCHAR NOT NULL,
    full_name VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(group_id, telegram_id)
);

-- 3. tk_schedules (Lịch làm việc)
CREATE TABLE IF NOT EXISTS tk_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES tk_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES tk_users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    shift_type VARCHAR NOT NULL, -- CA_1, CA_2, OFF
    is_locked BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- 4. tk_reports (Báo cáo đi muộn/nghỉ đột xuất)
CREATE TABLE IF NOT EXISTS tk_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES tk_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES tk_users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    report_type VARCHAR NOT NULL, -- LATE, ABSENT
    reported_at TIMESTAMP WITH TIME ZONE NOT NULL,
    reason TEXT,
    is_valid BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. tk_check_ins (Dữ liệu gửi Video)
CREATE TABLE IF NOT EXISTS tk_check_ins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES tk_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES tk_users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    check_in_time TIMESTAMP WITH TIME ZONE NOT NULL,
    video_file_id VARCHAR NOT NULL,
    status VARCHAR DEFAULT 'PENDING', -- PENDING, APPROVED, REJECTED
    admin_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. tk_penalties (Bảng tiền phạt)
CREATE TABLE IF NOT EXISTS tk_penalties (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES tk_groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES tk_users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    violation_type VARCHAR NOT NULL, -- LATE, UNAUTHORIZED_ABSENT, DRESS_CODE, CONSECUTIVE_LEAVE
    late_minutes INTEGER,
    amount INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    is_paid BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
