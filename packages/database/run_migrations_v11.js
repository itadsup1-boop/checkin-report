import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log('Running migration V11 (Add doctor, nurse to customer_appointments)...');
        
        await pool.query('ALTER TABLE customer_appointments ADD COLUMN IF NOT EXISTS doctor VARCHAR;');
        await pool.query('ALTER TABLE customer_appointments ADD COLUMN IF NOT EXISTS nurse VARCHAR;');
        
        console.log('✅ Migration V11 successful!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration V11 failed:', e);
        process.exit(1);
    }
}

run();
