BEGIN;

-- Thêm cột liên kết tài khoản điểm danh cá nhân vào employee_group_memberships
ALTER TABLE public.employee_group_memberships
    ADD COLUMN IF NOT EXISTS linked_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS linked_telegram_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS linked_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_egm_linked_employee_id ON public.employee_group_memberships(linked_employee_id);

COMMIT;
