BEGIN;

CREATE TABLE IF NOT EXISTS public.employee_registration_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    suggested_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    target_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    telegram_id VARCHAR(50) NOT NULL,
    telegram_username VARCHAR(255),
    telegram_group_id VARCHAR(50) NOT NULL REFERENCES public.telegram_groups(telegram_group_id),
    requested_full_name VARCHAR(255) NOT NULL,
    requested_role VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'ACTIVE', 'REJECTED')),
    is_new_profile BOOLEAN NOT NULL DEFAULT FALSE,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(255),
    rejection_reason TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
        (status = 'PENDING' AND reviewed_at IS NULL)
        OR (status IN ('ACTIVE', 'REJECTED') AND reviewed_at IS NOT NULL)
    ),
    CHECK (status <> 'REJECTED' OR NULLIF(TRIM(rejection_reason), '') IS NOT NULL)
);

-- Giữ lại các yêu cầu PENDING đã phát sinh sau v29 nếu migration v30 được chạy
-- khi hệ thống đang hoạt động.
INSERT INTO public.employee_registration_requests
    (suggested_employee_id, telegram_id, telegram_username, telegram_group_id,
     requested_full_name, requested_role, status, is_new_profile, requested_at)
SELECT employee.id,
       employee.pending_telegram_id,
       employee.pending_telegram_username,
       COALESCE(employee.pending_telegram_group_id, employee.telegram_group_id),
       employee.full_name,
       employee.pending_role,
       'PENDING',
       employee.pending_is_new_profile,
       COALESCE(employee.pending_requested_at, NOW())
FROM public.employees employee
WHERE employee.pending_telegram_id IS NOT NULL
  AND COALESCE(employee.pending_telegram_group_id, employee.telegram_group_id) IS NOT NULL
  AND employee.pending_role IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM public.employee_registration_requests existing
      WHERE existing.telegram_id = employee.pending_telegram_id
        AND existing.telegram_group_id = COALESCE(
            employee.pending_telegram_group_id,
            employee.telegram_group_id
        )
        AND existing.status = 'PENDING'
  );

-- Một Telegram chỉ có một yêu cầu đang chờ trong cùng nhóm, nhưng lịch sử
-- ACTIVE/REJECTED vẫn được giữ lại đầy đủ.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_registration_pending_identity
    ON public.employee_registration_requests (telegram_id, telegram_group_id)
    WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_employee_registration_status_requested
    ON public.employee_registration_requests (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_registration_group_requested
    ON public.employee_registration_requests (telegram_group_id, requested_at DESC);

COMMIT;
