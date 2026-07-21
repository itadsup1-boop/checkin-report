import pool from './index.js';

async function run() {
    try {
        await pool.query('ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS kpi_sheet_id VARCHAR;');
        await pool.query('ALTER TABLE telegram_groups ADD COLUMN IF NOT EXISTS customer_sheet_id VARCHAR;');
        console.log('Successfully added columns kpi_sheet_id, customer_sheet_id to telegram_groups.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}
run();
