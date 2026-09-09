import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log('Running migration V16 (Add request_group_id column)...');

        await pool.query(`
            ALTER TABLE public.tk_warehouse_transactions 
            ADD COLUMN IF NOT EXISTS request_group_id VARCHAR(50);
        `);
        
        console.log('✅ Successfully added column request_group_id to tk_warehouse_transactions');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration V16 failed:', e);
        process.exit(1);
    }
}

run();
