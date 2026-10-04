import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log('Running migration V15 (Add proof_folder_url column)...');

        await pool.query(`
            ALTER TABLE public.tk_warehouse_transactions 
            ADD COLUMN IF NOT EXISTS proof_folder_url VARCHAR(500);
        `);
        
        console.log('✅ Successfully added column proof_folder_url to tk_warehouse_transactions');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration V15 failed:', e);
        process.exit(1);
    }
}

run();
