import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        await client.query(`
            CREATE TABLE IF NOT EXISTS public.employee_group_memberships (
                employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
                telegram_group_id VARCHAR NOT NULL REFERENCES public.telegram_groups(telegram_group_id) ON DELETE CASCADE,
                status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                need_report BOOLEAN NOT NULL DEFAULT TRUE,
                current_kpi_target NUMERIC NOT NULL DEFAULT 0,
                pause_reason TEXT,
                paused_at TIMESTAMPTZ,
                resumed_at TIMESTAMPTZ,
                last_registered_at TIMESTAMPTZ DEFAULT NOW(),
                updated_by VARCHAR(255),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (employee_id, telegram_group_id),
                CONSTRAINT employee_group_memberships_status_check
                    CHECK (status IN ('ACTIVE', 'PAUSED'))
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_employee_group_memberships_group_status
                ON public.employee_group_memberships (telegram_group_id, status, need_report)
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS public.employee_group_membership_events (
                id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
                telegram_group_id VARCHAR NOT NULL REFERENCES public.telegram_groups(telegram_group_id) ON DELETE CASCADE,
                old_status VARCHAR(20),
                new_status VARCHAR(20) NOT NULL,
                reason TEXT,
                actor VARCHAR(255),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_employee_group_membership_events_lookup
                ON public.employee_group_membership_events (employee_id, telegram_group_id, created_at DESC)
        `);

        // Chỉ backfill các nhóm KPI; các role chấm công, kho và hồ sơ khách hàng
        // tiếp tục dùng cấu trúc hiện tại và không bị migration tác động.
        await client.query(`
            INSERT INTO public.employee_group_memberships
                (employee_id, telegram_group_id, status, need_report, current_kpi_target, last_registered_at)
            SELECT e.id,
                   e.telegram_group_id,
                   'ACTIVE',
                   COALESCE(e.need_report, TRUE),
                   COALESCE(e.current_kpi_target, 0),
                   NOW()
            FROM public.employees e
            JOIN public.telegram_groups g ON g.telegram_group_id = e.telegram_group_id
            WHERE e.telegram_group_id IS NOT NULL
              AND g.bot_role IN ('report', 'report_tour')
            ON CONFLICT (employee_id, telegram_group_id) DO NOTHING
        `);

        // pending_reports phải độc lập theo nhóm. Dữ liệu hiện tại đã có group_id;
        // vẫn bổ sung bước dọn an toàn cho database cũ trước khi đặt NOT NULL.
        await client.query(`
            UPDATE public.pending_reports pr
            SET group_id = e.telegram_group_id
            FROM public.employees e
            WHERE pr.telegram_id = e.telegram_id
              AND (pr.group_id IS NULL OR pr.group_id = '')
              AND e.telegram_group_id IS NOT NULL
              AND e.telegram_group_id <> ''
        `);
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM public.pending_reports
                    WHERE group_id IS NULL OR group_id = ''
                ) THEN
                    RAISE EXCEPTION 'Cannot scope every pending_reports row to a Telegram group';
                END IF;
            END $$
        `);
        await client.query(`ALTER TABLE public.pending_reports ALTER COLUMN group_id SET NOT NULL`);
        await client.query(`ALTER TABLE public.pending_reports DROP CONSTRAINT IF EXISTS pending_reports_pkey`);
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conrelid = 'public.pending_reports'::regclass
                      AND conname = 'pending_reports_pkey'
                ) THEN
                    ALTER TABLE public.pending_reports
                        ADD CONSTRAINT pending_reports_pkey PRIMARY KEY (telegram_id, group_id);
                END IF;
            END $$
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_pending_reports_group_status
                ON public.pending_reports (group_id, status, deadline_at)
        `);

        await client.query('COMMIT');
        console.log('✅ Migration V18: per-group KPI memberships and scoped pending reports are ready.');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Migration V18 failed:', error);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

run();
