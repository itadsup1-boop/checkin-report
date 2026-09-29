import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        const r = await pool.query("SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'group_settings'");
        console.log('Columns:', r.rows.map(x => `${x.column_name} (${x.data_type}) default: ${x.column_default}`));

        const rows = await pool.query("SELECT id, telegram_group_id, attendance_policy, checkout_min_time, checkout_deadline, effective_start_date FROM group_settings");
        console.log('All group settings:', rows.rows);
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
