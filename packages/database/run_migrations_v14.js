import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
    try {
        console.log("Starting Database Migration v14 (Warehouse branch additions)...");

        // 1. Add branch to tk_warehouse_transactions
        await pool.query(`
            ALTER TABLE tk_warehouse_transactions 
            ADD COLUMN IF NOT EXISTS branch VARCHAR(10) DEFAULT 'US' NOT NULL
        `);
        console.log("  -> Added branch column to tk_warehouse_transactions.");

        // 2. Add branch to tk_inventory
        await pool.query(`
            ALTER TABLE tk_inventory 
            ADD COLUMN IF NOT EXISTS branch VARCHAR(10) DEFAULT 'US' NOT NULL
        `);
        console.log("  -> Added branch column to tk_inventory.");

        // 3. Drop existing primary key constraint on tk_inventory and create composite key (product_id, branch)
        try {
            await pool.query(`
                ALTER TABLE tk_inventory DROP CONSTRAINT IF EXISTS tk_inventory_pkey
            `);
            console.log("  -> Dropped old primary key constraint on tk_inventory.");
        } catch (e) {
            console.warn("  -> Warn during drop constraint:", e.message);
        }

        await pool.query(`
            ALTER TABLE tk_inventory ADD CONSTRAINT tk_inventory_pkey PRIMARY KEY (product_id, branch)
        `);
        console.log("  -> Added composite primary key (product_id, branch) to tk_inventory.");

        console.log("Migration v14 completed successfully.");
        process.exit(0);
    } catch (err) {
        console.error("Migration v14 failed:", err);
        process.exit(1);
    }
}
run();
