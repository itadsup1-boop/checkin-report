import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';

async function run() {
    const updateBoss = await pool.query(`
        UPDATE employees SET is_active = false 
        WHERE full_name ILIKE '%Boss%' OR full_name ILIKE '%Đỗ thị thúy vân%'
        RETURNING *
    `);
    console.log(`Deactivated ${updateBoss.rows.length} test users`);

    // Let's also check why sync sheets might be hanging.
    // It's possible the script is stuck or it has finished but node is hanging because of open DB pool
    // wait, debug_sync.js has `run().then(() => process.exit(0))` which forces exit.
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
