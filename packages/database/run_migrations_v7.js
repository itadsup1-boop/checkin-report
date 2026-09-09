import pool from './index.js';

async function run() {
    try {
        console.log('Running Migration v7 (Báo bù công tour)...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tour_makeup_requests (
                id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
                telegram_group_id VARCHAR REFERENCES telegram_groups(telegram_group_id) ON DELETE CASCADE,
                telegram_id VARCHAR NOT NULL,
                employee_name VARCHAR NOT NULL,
                request_type VARCHAR(50) NOT NULL CHECK (request_type IN ('EXISTING_APPOINTMENT', 'MISSING_APPOINTMENT')),
                original_appointment_id INTEGER REFERENCES customer_appointments(id) ON DELETE SET NULL,
                work_date DATE NOT NULL,
                appointment_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
                customer_name VARCHAR(255) NOT NULL,
                customer_phone VARCHAR(50) NOT NULL,
                service VARCHAR(255) NOT NULL,
                sessions VARCHAR(50) NOT NULL,
                session_type VARCHAR(50) NOT NULL DEFAULT 'Bán',
                revenue VARCHAR(50) NOT NULL,
                reason TEXT NOT NULL,
                proof_image TEXT NOT NULL,
                status VARCHAR(50) NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
                submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                reviewed_at TIMESTAMP WITH TIME ZONE,
                reviewed_by VARCHAR(255),
                review_note TEXT,
                approved_appointment_id INTEGER REFERENCES customer_appointments(id) ON DELETE SET NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Table tour_makeup_requests checked/created.');

        // Index optimization
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_makeup_group ON tour_makeup_requests(telegram_group_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_makeup_employee ON tour_makeup_requests(telegram_id);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_makeup_status ON tour_makeup_requests(status);`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_tour_makeup_work_date ON tour_makeup_requests(work_date);`);
        console.log('✅ Indexes for tour_makeup_requests checked/created.');

        console.log('Migration v7 completed successfully.');
    } finally {
        await pool.end();
    }
}

run().catch((error) => {
    console.error('❌ Migration v7 failed:', error);
    process.exit(1);
});
