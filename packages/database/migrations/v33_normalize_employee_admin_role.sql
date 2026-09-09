BEGIN;
UPDATE public.employees SET role = 'admin' WHERE lower(trim(role)) = 'admin' AND role <> 'admin';
UPDATE public.employee_group_memberships SET role = 'admin' WHERE lower(trim(role)) = 'admin' AND role <> 'admin';
COMMIT;
