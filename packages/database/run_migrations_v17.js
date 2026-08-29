import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.customer_record_telegram_media (
                id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                customer_record_id UUID NOT NULL REFERENCES public.customer_records(id) ON DELETE CASCADE,
                telegram_file_id TEXT NOT NULL,
                telegram_file_unique_id TEXT NOT NULL,
                telegram_chat_id VARCHAR(64) NOT NULL,
                telegram_message_id BIGINT NOT NULL,
                telegram_media_group_id VARCHAR(128),
                media_type VARCHAR(20) NOT NULL,
                mime_type VARCHAR(255),
                file_name TEXT,
                file_size BIGINT DEFAULT 0,
                status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
                drive_url TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                next_retry_at TIMESTAMPTZ DEFAULT NOW(),
                last_error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                uploaded_at TIMESTAMPTZ,
                CONSTRAINT customer_record_telegram_media_status_check
                    CHECK (status IN ('PENDING', 'PROCESSING', 'UPLOADED', 'FAILED')),
                CONSTRAINT customer_record_telegram_media_unique_file
                    UNIQUE (customer_record_id, telegram_file_unique_id)
            );

            CREATE INDEX IF NOT EXISTS idx_customer_record_telegram_media_queue
                ON public.customer_record_telegram_media (status, next_retry_at, created_at);
        `);

        console.log('✅ Migration V17: customer Telegram reply media queue is ready.');
    } catch (error) {
        console.error('❌ Migration V17 failed:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();
