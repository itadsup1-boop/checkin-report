import fs from 'node:fs/promises';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        const migrationUrl = new URL('./migrations/v19_warehouse_service_orders.sql', import.meta.url);
        const sql = await fs.readFile(migrationUrl, 'utf8');
        await pool.query(sql);
        console.log('✅ Migration V19: warehouse service orders are ready (feature flag remains OFF).');
    } catch (error) {
        console.error('❌ Migration V19 failed:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();
