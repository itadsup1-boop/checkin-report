import pool from './index.js';

async function run() {
    try {
        console.log('Running Migration v4...');

        // 1. Create admin_accounts table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_accounts (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                username VARCHAR UNIQUE NOT NULL,
                password_hash VARCHAR NOT NULL,
                full_name VARCHAR,
                role VARCHAR NOT NULL DEFAULT 'ADMIN', -- 'SUPER_ADMIN', 'ADMIN'
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Table admin_accounts checked/created.');

        // 2. Create admin_group_mappings table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_group_mappings (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                admin_id UUID REFERENCES admin_accounts(id) ON DELETE CASCADE,
                telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id) ON DELETE CASCADE,
                UNIQUE(admin_id, telegram_group_id)
            );
        `);
        console.log('✅ Table admin_group_mappings checked/created.');

        // 3. Seed default Super Admin account if not exists
        const checkAdmin = await pool.query(`SELECT * FROM admin_accounts WHERE username = 'admin'`);
        if (checkAdmin.rows.length === 0) {
            await pool.query(`
                INSERT INTO admin_accounts (username, password_hash, full_name, role)
                VALUES ('admin', 'admin123', 'Super Administrator', 'SUPER_ADMIN')
            `);
            console.log('✅ Default Super Admin (admin / admin123) seeded.');
        } else {
            console.log('ℹ️ Admin account "admin" already exists.');
        }

        console.log('Migration v4 completed successfully.');
    } catch (e) {
        console.error('❌ Migration v4 failed:', e);
    } finally {
        await pool.end();
    }
}

run();
