BEGIN;

ALTER TABLE public.employee_group_memberships
    ADD COLUMN IF NOT EXISTS role VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_exempt_checkin BOOLEAN;

UPDATE public.employee_group_memberships membership
SET role = COALESCE(membership.role, employee.role),
    is_exempt_checkin = COALESCE(membership.is_exempt_checkin, employee.is_exempt_checkin)
FROM public.employees employee
WHERE employee.id = membership.employee_id
  AND (membership.role IS NULL OR membership.is_exempt_checkin IS NULL);

COMMIT;
