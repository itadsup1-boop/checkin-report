import pool from '../packages/database/index.js';

async function run() {
    console.log('=== 1. GIAO DỊCH XUẤT KHO GẦN NHẤT ===');
    const tx = await pool.query(`
        SELECT t.*, p.product_name, p.barcode, e.full_name, e.telegram_id, e.id as emp_id, e.role, g.telegram_group_id, g.group_name
        FROM tk_warehouse_transactions t
        JOIN tk_products p ON t.product_id = p.id
        JOIN employees e ON t.user_id = e.id
        JOIN telegram_groups g ON t.group_id = g.id
        ORDER BY t.created_at DESC
        LIMIT 5
    `);
    console.table(tx.rows.map(r => ({
        id: r.id,
        request_group_id: r.request_group_id,
        product: r.product_name,
        quantity: r.quantity,
        status: r.status,
        branch: r.branch,
        user: r.full_name,
        role: r.role,
        telegram_id: r.telegram_id,
        emp_id: r.emp_id,
        group_tg_id: r.telegram_group_id,
        created_at: r.created_at
    })));

    if (tx.rows.length > 0) {
        const latestTx = tx.rows[0];
        console.log('\n=== 2. QUYỀN CỦA NHÂN SỰ NÀY TRONG NHÓM KHO ===');
        const perms = await pool.query(`
            SELECT * FROM tk_warehouse_permissions
            WHERE employee_id = $1 AND telegram_group_id = $2
        `, [latestTx.emp_id, latestTx.telegram_group_id]);
        console.log('tk_warehouse_permissions:', perms.rows);

        const allPermsUser = await pool.query(`
            SELECT * FROM tk_warehouse_permissions
            WHERE employee_id = $1
        `, [latestTx.emp_id]);
        console.log('Tất cả permissions của nhân sự này ở mọi nhóm:', allPermsUser.rows);

        console.log('\n=== 3. AI ĐANG CÓ QUYỀN DUYỆT TRONG NHÓM NÀY ===');
        const groupPerms = await pool.query(`
            SELECT p.*, e.full_name, e.telegram_id
            FROM tk_warehouse_permissions p
            JOIN employees e ON p.employee_id = e.id
            WHERE p.telegram_group_id = $1
        `, [latestTx.telegram_group_id]);
        console.table(groupPerms.rows.map(r => ({
            name: r.full_name,
            telegram_id: r.telegram_id,
            permission: r.permission_code,
            is_active: r.is_active
        })));

        console.log('\n=== 4. CẤU HÌNH ADMIN_IDS TRONG .ENV ===');
        console.log('ADMIN_IDS =', process.env.ADMIN_IDS);
    }
}

run()
    .then(async () => {
        await pool.end();
        process.exit(0);
    })
    .catch(async err => {
        console.error(err);
        await pool.end();
        process.exit(1);
    });
