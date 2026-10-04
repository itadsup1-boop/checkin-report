BEGIN;

CREATE TABLE IF NOT EXISTS public.tk_warehouse_order_edits (
    id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    target_type VARCHAR(20) NOT NULL,
    order_id UUID REFERENCES public.tk_warehouse_orders(id) ON DELETE RESTRICT,
    transaction_id UUID REFERENCES public.tk_warehouse_transactions(id) ON DELETE RESTRICT,
    editor_employee_id UUID REFERENCES public.employees(id) ON DELETE RESTRICT,
    editor_telegram_id VARCHAR(64) NOT NULL,
    edit_reason TEXT NOT NULL,
    changes_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tk_wh_order_edits_target_check CHECK (target_type IN ('EXPORT', 'IMPORT'))
);

CREATE INDEX IF NOT EXISTS idx_wh_order_edits_order ON public.tk_warehouse_order_edits (order_id);
CREATE INDEX IF NOT EXISTS idx_wh_order_edits_transaction ON public.tk_warehouse_order_edits (transaction_id);

ALTER TABLE public.tk_warehouse_orders
    ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.tk_warehouse_transactions
    ADD COLUMN IF NOT EXISTS edit_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_edited_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;

COMMIT;
