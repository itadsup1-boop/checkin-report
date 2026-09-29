import pool from '../packages/database/index.js';

async function checkCols() {
    const cols = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'group_settings'");
    console.log('COLS:', cols.rows.map(r => r.column_name));
}

checkCols().catch(console.error).finally(() => pool.end());
