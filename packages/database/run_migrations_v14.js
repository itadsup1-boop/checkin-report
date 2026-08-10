import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log('Running migration V14 (Add non-negative check constraint on tk_inventory)...');

        await pool.query(`
            ALTER TABLE public.tk_inventory 
            ADD CONSTRAINT chk_inventory_qty_non_negative 
            CHECK (quantity >= 0);
        `);
        
        console.log('✅ Successfully added constraint chk_inventory_qty_non_negative');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration V14 failed:', e);
        process.exit(1);
    }
}

run();
