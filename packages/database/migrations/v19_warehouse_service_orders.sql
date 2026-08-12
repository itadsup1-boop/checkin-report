BEGIN;

ALTER TABLE public.telegram_groups
    ADD COLUMN IF NOT EXISTS warehouse_service_order_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS warehouse_drive_folder_id VARCHAR;

ALTER TABLE public.tk_products
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tk_inventory_quantity_nonnegative'
          AND conrelid = 'public.tk_inventory'::regclass
    ) THEN
        ALTER TABLE public.tk_inventory
            ADD CONSTRAINT tk_inventory_quantity_nonnegative CHECK (quantity >= 0) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.tk_inventory
    VALIDATE CONSTRAINT tk_inventory_quantity_nonnegative;

CREATE TABLE IF NOT EXISTS public.tk_warehouse_services (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    service_code VARCHAR(50) NOT NULL UNIQUE,
    service_name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_by_admin_id VARCHAR(255),
    updated_by_admin_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_warehouse_services_code_not_blank CHECK (BTRIM(service_code) <> ''),
    CONSTRAINT tk_warehouse_services_name_not_blank CHECK (BTRIM(service_name) <> '')
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_service_products (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES public.tk_warehouse_services(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.tk_products(id) ON DELETE RESTRICT,
    default_quantity INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    updated_by_admin_id VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_warehouse_service_products_quantity_positive CHECK (default_quantity > 0),
    CONSTRAINT tk_warehouse_service_products_unique UNIQUE (service_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_template_audit (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    service_id UUID REFERENCES public.tk_warehouse_services(id) ON DELETE RESTRICT,
    service_product_id UUID REFERENCES public.tk_warehouse_service_products(id) ON DELETE RESTRICT,
    action VARCHAR(40) NOT NULL,
    before_data JSONB,
    after_data JSONB,
    actor_admin_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_permissions (
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    telegram_group_id VARCHAR NOT NULL REFERENCES public.telegram_groups(telegram_group_id) ON DELETE CASCADE,
    permission_code VARCHAR(50) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    granted_by_admin_id VARCHAR(255) NOT NULL,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (employee_id, telegram_group_id, permission_code),
    CONSTRAINT tk_warehouse_permissions_code_check CHECK (
        permission_code IN (
            'APPROVE_EXPORT',
            'AUTO_APPROVE_OWN_ORDER',
            'APPROVE_TRANSFER',
            'MANAGE_TEMPLATES',
            'MANAGE_PRODUCTS',
            'ADJUST_INVENTORY',
            'VIEW_REPORTS'
        )
    )
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_permission_audit (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    telegram_group_id VARCHAR NOT NULL REFERENCES public.telegram_groups(telegram_group_id) ON DELETE CASCADE,
    permission_code VARCHAR(50) NOT NULL,
    old_is_active BOOLEAN,
    new_is_active BOOLEAN NOT NULL,
    actor_admin_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_orders (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    order_code VARCHAR(40) NOT NULL UNIQUE,
    group_id UUID NOT NULL REFERENCES public.telegram_groups(id) ON DELETE RESTRICT,
    created_by UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_by_telegram_id VARCHAR(64) NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    customer_phone VARCHAR(50) NOT NULL,
    branch VARCHAR(10) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    idempotency_key VARCHAR(100) NOT NULL,
    approved_by UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
    approved_by_telegram_id VARCHAR(64),
    approved_at TIMESTAMPTZ,
    rejected_by UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
    rejected_by_telegram_id VARCHAR(64),
    rejected_at TIMESTAMPTZ,
    reversed_by_admin_id VARCHAR(255),
    reversed_at TIMESTAMPTZ,
    telegram_chat_id VARCHAR(64),
    telegram_message_id BIGINT,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_warehouse_orders_customer_name_not_blank CHECK (BTRIM(customer_name) <> ''),
    CONSTRAINT tk_warehouse_orders_customer_phone_not_blank CHECK (BTRIM(customer_phone) <> ''),
    CONSTRAINT tk_warehouse_orders_branch_check CHECK (branch IN ('US', 'UK')),
    CONSTRAINT tk_warehouse_orders_status_check CHECK (
        status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERSED')
    ),
    CONSTRAINT tk_warehouse_orders_sync_status_check CHECK (
        sync_status IN ('PENDING', 'SYNCED', 'FAILED')
    ),
    CONSTRAINT tk_warehouse_orders_idempotency_unique UNIQUE (group_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_order_services (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.tk_warehouse_orders(id) ON DELETE CASCADE,
    service_id UUID REFERENCES public.tk_warehouse_services(id) ON DELETE RESTRICT,
    service_code_snapshot VARCHAR(50) NOT NULL,
    service_name_snapshot VARCHAR(255) NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_order_items (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    order_service_id UUID NOT NULL REFERENCES public.tk_warehouse_order_services(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.tk_products(id) ON DELETE RESTRICT,
    product_name_snapshot VARCHAR(255) NOT NULL,
    barcode_snapshot VARCHAR(100) NOT NULL,
    template_quantity INTEGER,
    actual_quantity INTEGER NOT NULL,
    item_source VARCHAR(20) NOT NULL DEFAULT 'TEMPLATE',
    is_removed BOOLEAN NOT NULL DEFAULT FALSE,
    display_order INTEGER NOT NULL DEFAULT 0,
    local_allocated_quantity INTEGER NOT NULL DEFAULT 0,
    transfer_allocated_quantity INTEGER NOT NULL DEFAULT 0,
    transfer_from_branch VARCHAR(10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_warehouse_order_items_template_quantity_check CHECK (
        template_quantity IS NULL OR template_quantity > 0
    ),
    CONSTRAINT tk_warehouse_order_items_actual_quantity_check CHECK (actual_quantity > 0),
    CONSTRAINT tk_warehouse_order_items_source_check CHECK (item_source IN ('TEMPLATE', 'MANUAL')),
    CONSTRAINT tk_warehouse_order_items_allocations_check CHECK (
        local_allocated_quantity >= 0 AND transfer_allocated_quantity >= 0
    ),
    CONSTRAINT tk_warehouse_order_items_transfer_branch_check CHECK (
        transfer_from_branch IS NULL OR transfer_from_branch IN ('US', 'UK')
    )
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_transfers (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    transfer_code VARCHAR(40) NOT NULL UNIQUE,
    order_id UUID NOT NULL REFERENCES public.tk_warehouse_orders(id) ON DELETE RESTRICT,
    telegram_group_id VARCHAR NOT NULL REFERENCES public.telegram_groups(telegram_group_id) ON DELETE RESTRICT,
    from_branch VARCHAR(10) NOT NULL,
    to_branch VARCHAR(10) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'NOTIFIED',
    confirmed_by UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
    confirmed_by_telegram_id VARCHAR(64) NOT NULL,
    confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_warehouse_transfers_branch_check CHECK (
        from_branch IN ('US', 'UK') AND to_branch IN ('US', 'UK') AND from_branch <> to_branch
    ),
    CONSTRAINT tk_warehouse_transfers_status_check CHECK (status IN ('NOTIFIED', 'REVERSED'))
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_transfer_items (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    transfer_id UUID NOT NULL REFERENCES public.tk_warehouse_transfers(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.tk_products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_warehouse_transfer_items_quantity_positive CHECK (quantity > 0),
    CONSTRAINT tk_warehouse_transfer_items_unique UNIQUE (transfer_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_ledger (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    event_key VARCHAR(160) NOT NULL UNIQUE,
    event_type VARCHAR(40) NOT NULL,
    order_id UUID REFERENCES public.tk_warehouse_orders(id) ON DELETE RESTRICT,
    transfer_id UUID REFERENCES public.tk_warehouse_transfers(id) ON DELETE RESTRICT,
    legacy_transaction_id UUID REFERENCES public.tk_warehouse_transactions(id) ON DELETE RESTRICT,
    group_id UUID NOT NULL REFERENCES public.telegram_groups(id) ON DELETE RESTRICT,
    product_id UUID NOT NULL REFERENCES public.tk_products(id) ON DELETE RESTRICT,
    branch VARCHAR(10) NOT NULL,
    quantity_delta INTEGER NOT NULL,
    balance_before INTEGER NOT NULL,
    balance_after INTEGER NOT NULL,
    actor_employee_id UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
    actor_telegram_id VARCHAR(64) NOT NULL,
    approved_by_employee_id UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
    proof_folder_url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_warehouse_ledger_event_type_check CHECK (
        event_type IN (
            'PRODUCT_IMPORT',
            'CUSTOMER_EXPORT',
            'TRANSFER_OUT',
            'TRANSFER_IN_DIRECT_USE',
            'ADJUSTMENT_INCREASE',
            'ADJUSTMENT_DECREASE',
            'REVERSAL'
        )
    ),
    CONSTRAINT tk_warehouse_ledger_branch_check CHECK (branch IN ('US', 'UK')),
    CONSTRAINT tk_warehouse_ledger_delta_nonzero CHECK (quantity_delta <> 0),
    CONSTRAINT tk_warehouse_ledger_balance_check CHECK (balance_before >= 0 AND balance_after >= 0)
);

CREATE TABLE IF NOT EXISTS public.tk_warehouse_outbox (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    aggregate_type VARCHAR(40) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::JSONB,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT tk_warehouse_outbox_status_check CHECK (
        status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')
    ),
    CONSTRAINT tk_warehouse_outbox_attempts_check CHECK (attempts >= 0),
    CONSTRAINT tk_warehouse_outbox_unique UNIQUE (aggregate_type, aggregate_id, event_type)
);

-- Các ALTER dưới đây giữ migration chạy lặp an toàn nếu một bản V19 sớm hơn
-- đã tạo bảng nhưng chưa có metadata Telegram dành cho Admin.
ALTER TABLE public.tk_warehouse_orders
    ADD COLUMN IF NOT EXISTS approved_by_telegram_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS rejected_by_telegram_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS created_by_telegram_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS reversed_by_admin_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE public.tk_warehouse_orders
    ALTER COLUMN created_by DROP NOT NULL;
UPDATE public.tk_warehouse_orders o
SET created_by_telegram_id = COALESCE(o.created_by_telegram_id, e.telegram_id, 'unknown')
FROM public.employees e
WHERE o.created_by = e.id
  AND o.created_by_telegram_id IS NULL;
UPDATE public.tk_warehouse_orders
SET created_by_telegram_id = 'unknown'
WHERE created_by_telegram_id IS NULL;
ALTER TABLE public.tk_warehouse_orders
    ALTER COLUMN created_by_telegram_id SET NOT NULL;

ALTER TABLE public.tk_warehouse_orders
    DROP CONSTRAINT IF EXISTS tk_warehouse_orders_status_check;
ALTER TABLE public.tk_warehouse_orders
    ADD CONSTRAINT tk_warehouse_orders_status_check CHECK (
        status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERSED')
    );

ALTER TABLE public.tk_warehouse_transfers
    ADD COLUMN IF NOT EXISTS confirmed_by_telegram_id VARCHAR(64);
ALTER TABLE public.tk_warehouse_transfers
    ALTER COLUMN confirmed_by DROP NOT NULL;
UPDATE public.tk_warehouse_transfers t
SET confirmed_by_telegram_id = COALESCE(
    t.confirmed_by_telegram_id,
    e.telegram_id,
    'unknown'
)
FROM public.employees e
WHERE t.confirmed_by = e.id
  AND t.confirmed_by_telegram_id IS NULL;
UPDATE public.tk_warehouse_transfers
SET confirmed_by_telegram_id = 'unknown'
WHERE confirmed_by_telegram_id IS NULL;
ALTER TABLE public.tk_warehouse_transfers
    ALTER COLUMN confirmed_by_telegram_id SET NOT NULL;
ALTER TABLE public.tk_warehouse_transfers
    DROP CONSTRAINT IF EXISTS tk_warehouse_transfers_status_check;
ALTER TABLE public.tk_warehouse_transfers
    ADD CONSTRAINT tk_warehouse_transfers_status_check CHECK (status IN ('NOTIFIED', 'REVERSED'));

ALTER TABLE public.tk_warehouse_ledger
    ADD COLUMN IF NOT EXISTS actor_telegram_id VARCHAR(64);
ALTER TABLE public.tk_warehouse_ledger
    ALTER COLUMN actor_employee_id DROP NOT NULL;
UPDATE public.tk_warehouse_ledger l
SET actor_telegram_id = COALESCE(l.actor_telegram_id, e.telegram_id, 'unknown')
FROM public.employees e
WHERE l.actor_employee_id = e.id
  AND l.actor_telegram_id IS NULL;
UPDATE public.tk_warehouse_ledger
SET actor_telegram_id = 'unknown'
WHERE actor_telegram_id IS NULL;
ALTER TABLE public.tk_warehouse_ledger
    ALTER COLUMN actor_telegram_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tk_warehouse_services_active_order
    ON public.tk_warehouse_services (is_active, display_order, service_name);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_service_products_service
    ON public.tk_warehouse_service_products (service_id, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_permissions_group
    ON public.tk_warehouse_permissions (telegram_group_id, employee_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_orders_group_status
    ON public.tk_warehouse_orders (group_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_orders_phone
    ON public.tk_warehouse_orders (customer_phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_order_services_order
    ON public.tk_warehouse_order_services (order_id, display_order);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_order_items_service
    ON public.tk_warehouse_order_items (order_service_id, display_order);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_transfers_order
    ON public.tk_warehouse_transfers (order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_ledger_monthly
    ON public.tk_warehouse_ledger (created_at, branch, product_id);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_ledger_order
    ON public.tk_warehouse_ledger (order_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tk_warehouse_outbox_queue
    ON public.tk_warehouse_outbox (status, next_retry_at, created_at);

COMMIT;
