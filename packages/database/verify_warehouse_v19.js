import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const requiredTables = [
    'tk_warehouse_services',
    'tk_warehouse_service_products',
    'tk_warehouse_template_audit',
    'tk_warehouse_permissions',
    'tk_warehouse_permission_audit',
    'tk_warehouse_orders',
    'tk_warehouse_order_services',
    'tk_warehouse_order_items',
    'tk_warehouse_transfers',
    'tk_warehouse_transfer_items',
    'tk_warehouse_ledger',
    'tk_warehouse_outbox'
];

const requiredColumns = [
    ['telegram_groups', 'warehouse_service_order_enabled'],
    ['telegram_groups', 'warehouse_drive_folder_id'],
    ['tk_products', 'is_active'],
    ['tk_warehouse_orders', 'approved_by_telegram_id'],
    ['tk_warehouse_orders', 'rejected_by_telegram_id'],
    ['tk_warehouse_orders', 'created_by_telegram_id'],
    ['tk_warehouse_orders', 'reversed_by_admin_id'],
    ['tk_warehouse_orders', 'reversed_at'],
    ['tk_warehouse_transfers', 'confirmed_by_telegram_id'],
    ['tk_warehouse_ledger', 'actor_telegram_id']
];

async function run() {
    try {
        const tables = await pool.query(
            `SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])`,
            [requiredTables]
        );
        const found = new Set(tables.rows.map(row => row.table_name));
        const missing = requiredTables.filter(table => !found.has(table));
        if (missing.length) throw new Error(`Thiếu bảng: ${missing.join(', ')}`);

        const columns = await pool.query(
            `SELECT table_name, column_name, is_nullable
             FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = ANY($1::text[])`,
            [[...new Set(requiredColumns.map(([table]) => table))]]
        );
        const columnMap = new Map(columns.rows.map(row => [`${row.table_name}.${row.column_name}`, row]));
        const missingColumns = requiredColumns.filter(([table, column]) =>
            !columnMap.has(`${table}.${column}`)
        );
        if (missingColumns.length) {
            throw new Error(`Thiếu cột: ${missingColumns.map(parts => parts.join('.')).join(', ')}`);
        }
        if (columnMap.get('tk_warehouse_ledger.actor_telegram_id').is_nullable !== 'NO') {
            throw new Error('tk_warehouse_ledger.actor_telegram_id phải NOT NULL');
        }
        if (columnMap.get('tk_warehouse_orders.created_by_telegram_id').is_nullable !== 'NO') {
            throw new Error('tk_warehouse_orders.created_by_telegram_id phải NOT NULL');
        }
        if (columnMap.get('tk_warehouse_transfers.confirmed_by_telegram_id').is_nullable !== 'NO') {
            throw new Error('tk_warehouse_transfers.confirmed_by_telegram_id phải NOT NULL');
        }

        const constraints = await pool.query(
            `SELECT conname, pg_get_constraintdef(oid) AS definition
             FROM pg_constraint
             WHERE conrelid IN (
                'public.tk_inventory'::regclass,
                'public.tk_warehouse_orders'::regclass,
                'public.tk_warehouse_transfers'::regclass
             )`
        );
        const constraintMap = new Map(constraints.rows.map(row => [row.conname, row.definition]));
        if (!constraintMap.has('tk_inventory_quantity_nonnegative')) {
            throw new Error('Thiếu ràng buộc chống tồn kho âm');
        }
        if (!constraintMap.get('tk_warehouse_orders_status_check')?.includes('REVERSED')) {
            throw new Error('Trạng thái hoàn tác đơn chưa được cấu hình');
        }

        const negative = await pool.query(
            'SELECT COUNT(*)::int AS count FROM tk_inventory WHERE quantity < 0'
        );
        if (negative.rows[0].count !== 0) throw new Error('Tồn tại tồn kho âm');

        console.log('✅ Warehouse V19 schema verification passed.');
    } catch (error) {
        console.error('❌ Warehouse V19 schema verification failed:', error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

run();
