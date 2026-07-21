-- 1. Alter employees table
ALTER TABLE employees ADD COLUMN IF NOT EXISTS role VARCHAR DEFAULT 'MEMBER';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_quota INTEGER DEFAULT 12;

-- 2. Alter group_settings table
ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS photo_deadline_minutes INT DEFAULT 120;
ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS penalty_per_photo NUMERIC DEFAULT 50000;
ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS shift_1_time VARCHAR(20) DEFAULT '08:30-18:00';
ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS shift_2_time VARCHAR(20) DEFAULT '08:30-18:00';
ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS penalty_under_15 NUMERIC DEFAULT 50000;
ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS penalty_under_90 NUMERIC DEFAULT 100000;
ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS penalty_over_90 NUMERIC DEFAULT 200000;

-- 3. Truncate test data from timekeep tables to avoid orphaned data when dropping tk_users
TRUNCATE TABLE tk_check_ins CASCADE;
TRUNCATE TABLE tk_schedules CASCADE;
TRUNCATE TABLE tk_leave_requests CASCADE;
TRUNCATE TABLE tk_penalties CASCADE;
TRUNCATE TABLE tk_reports CASCADE;

-- 4. Drop Foreign Keys pointing to tk_groups and tk_users
ALTER TABLE tk_check_ins DROP CONSTRAINT IF EXISTS tk_check_ins_group_id_fkey;
ALTER TABLE tk_check_ins DROP CONSTRAINT IF EXISTS tk_check_ins_user_id_fkey;

ALTER TABLE tk_schedules DROP CONSTRAINT IF EXISTS tk_schedules_group_id_fkey;
ALTER TABLE tk_schedules DROP CONSTRAINT IF EXISTS tk_schedules_user_id_fkey;

ALTER TABLE tk_leave_requests DROP CONSTRAINT IF EXISTS tk_leave_requests_group_id_fkey;
ALTER TABLE tk_leave_requests DROP CONSTRAINT IF EXISTS tk_leave_requests_user_id_fkey;

ALTER TABLE tk_penalties DROP CONSTRAINT IF EXISTS tk_penalties_group_id_fkey;
ALTER TABLE tk_penalties DROP CONSTRAINT IF EXISTS tk_penalties_user_id_fkey;

ALTER TABLE tk_reports DROP CONSTRAINT IF EXISTS tk_reports_group_id_fkey;
ALTER TABLE tk_reports DROP CONSTRAINT IF EXISTS tk_reports_user_id_fkey;

-- 5. Add New Foreign Keys pointing to telegram_groups and employees
ALTER TABLE tk_check_ins ADD CONSTRAINT tk_check_ins_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE tk_check_ins ADD CONSTRAINT tk_check_ins_user_id_fkey FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE tk_schedules ADD CONSTRAINT tk_schedules_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE tk_schedules ADD CONSTRAINT tk_schedules_user_id_fkey FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE tk_leave_requests ADD CONSTRAINT tk_leave_requests_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE tk_leave_requests ADD CONSTRAINT tk_leave_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE tk_penalties ADD CONSTRAINT tk_penalties_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE tk_penalties ADD CONSTRAINT tk_penalties_user_id_fkey FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE tk_reports ADD CONSTRAINT tk_reports_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id) ON DELETE CASCADE;
ALTER TABLE tk_reports ADD CONSTRAINT tk_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES employees(id) ON DELETE CASCADE;

-- 6. Copy settings from tk_group_settings to group_settings (if any exists)
INSERT INTO group_settings (telegram_group_id, photo_deadline_minutes, penalty_per_photo, shift_1_time, shift_2_time, penalty_under_15, penalty_under_90, penalty_over_90)
SELECT 
    telegram_group_id, 
    photo_deadline_minutes, 
    penalty_per_photo, 
    shift_1_time, 
    shift_2_time, 
    penalty_under_15, 
    penalty_under_90, 
    penalty_over_90
FROM tk_group_settings
ON CONFLICT (telegram_group_id) DO UPDATE SET
    photo_deadline_minutes = EXCLUDED.photo_deadline_minutes,
    penalty_per_photo = EXCLUDED.penalty_per_photo,
    shift_1_time = EXCLUDED.shift_1_time,
    shift_2_time = EXCLUDED.shift_2_time,
    penalty_under_15 = EXCLUDED.penalty_under_15,
    penalty_under_90 = EXCLUDED.penalty_under_90,
    penalty_over_90 = EXCLUDED.penalty_over_90;

-- 7. Drop obsolete tables
DROP TABLE IF EXISTS tk_users CASCADE;
DROP TABLE IF EXISTS tk_group_settings CASCADE;
DROP TABLE IF EXISTS tk_groups CASCADE;
