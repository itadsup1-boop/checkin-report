import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log('Running migration V13 (Create warehouse tables)...');

        // 1. Create table tk_products
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.tk_products (
                id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                barcode VARCHAR(100) UNIQUE NOT NULL,
                product_name VARCHAR(255) NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Created table tk_products');

        // 2. Create table tk_inventory
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.tk_inventory (
                product_id UUID PRIMARY KEY REFERENCES public.tk_products(id) ON DELETE CASCADE,
                quantity INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Created table tk_inventory');

        // 3. Create table tk_warehouse_transactions
        await pool.query(`
            CREATE TABLE IF NOT EXISTS public.tk_warehouse_transactions (
                id UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
                group_id UUID REFERENCES public.telegram_groups(id) ON DELETE CASCADE,
                user_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
                transaction_type VARCHAR(20) NOT NULL,
                product_id UUID REFERENCES public.tk_products(id) ON DELETE CASCADE,
                quantity INTEGER NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'APPROVED',
                approved_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
                approved_at TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Created table tk_warehouse_transactions');

        // 4. Create index
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.tk_products(barcode);
        `);
        console.log('✅ Created index idx_products_barcode');

        console.log('✅ Migration V13 successful!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Migration V13 failed:', e);
        process.exit(1);
    }
}

run();
