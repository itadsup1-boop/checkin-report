import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log('Running migration V12 (Add customer_records and customer_drive_folder_id)...');
        
        // 1. Create table customer_records
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.customer_records (
                id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                group_id UUID REFERENCES public.telegram_groups(id) ON DELETE SET NULL,
                creator_employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
                record_date DATE NOT NULL,
                consultant VARCHAR(255),
                customer_type VARCHAR(50),
                customer_name VARCHAR(255) NOT NULL,
                address TEXT,
                phone VARCHAR(50) NOT NULL,
                service TEXT,
                gift TEXT,
                bill_amount NUMERIC DEFAULT 0,
                paid_amount NUMERIC DEFAULT 0,
                debt_amount NUMERIC DEFAULT 0,
                operator VARCHAR(255),
                warranty TEXT,
                drive_folder_link TEXT,
                media_urls JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Created table customer_records');

        // 2. Alter telegram_groups table
        await pool.query('ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS customer_drive_folder_id VARCHAR;');
        console.log('✅ Added customer_drive_folder_id to telegram_groups');
        
        console.log('✅ Migration V12 successful!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration V12 failed:', e);
        process.exit(1);
    }
}

run();
