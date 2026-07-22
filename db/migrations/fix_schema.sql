ALTER TABLE employees ADD COLUMN IF NOT EXISTS group_id UUID;
UPDATE employees e SET group_id = g.id FROM telegram_groups g WHERE e.telegram_group_id = g.telegram_group_id AND e.group_id IS NULL;
ALTER TABLE employees ADD CONSTRAINT employees_group_id_fkey FOREIGN KEY (group_id) REFERENCES telegram_groups(id);
CREATE INDEX IF NOT EXISTS idx_employees_group_id ON employees(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_group_telegram_unique ON employees(group_id, telegram_id) WHERE telegram_id IS NOT NULL;
ALTER TABLE tk_schedules ADD COLUMN IF NOT EXISTS proof_url TEXT;
ALTER TABLE tk_schedules ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES employees(id);
ALTER TABLE tk_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE;
