import pool from '../packages/database/index.js';

async function migrate() {
    console.log('Starting DB migration...');
    try {
        await pool.query(`
            ALTER TABLE telegram_groups 
            ADD COLUMN IF NOT EXISTS bot_role VARCHAR(50) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
        `);
        console.log('Migration successful: Added bot_role and is_deleted to telegram_groups.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        pool.end();
    }
}

migrate();
