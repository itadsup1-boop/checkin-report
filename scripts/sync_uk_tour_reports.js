import dotenv from 'dotenv';
dotenv.config();
import pool from '../packages/database/index.js';

async function run() {
    try {
        const countRes = await pool.query('SELECT count(*) FROM ktv_tour_reports');
        console.log('Current ktv_tour_reports count:', countRes.rows[0].count);

        if (Number(countRes.rows[0].count) === 0) {
            console.log('Syncing from uk_tour_records to ktv_tour_reports for group -1002228375063 (UK)...');
            const insertRes = await pool.query(`
                INSERT INTO ktv_tour_reports (
                    group_id,
                    report_date,
                    customer_name,
                    phone,
                    customer_type,
                    doctor,
                    service,
                    ktv_names,
                    tour_credit,
                    is_valid,
                    status,
                    raw_text,
                    created_at,
                    updated_at
                )
                SELECT 
                    '-1002228375063' as group_id,
                    record_date::date as report_date,
                    TRIM(customer_name),
                    NULLIF(TRIM(phone), ''),
                    CASE 
                        WHEN TRIM(customer_type) ILIKE '%mới%' THEN 'Khách mới'
                        ELSE 'Khách cũ'
                    END as customer_type,
                    NULLIF(TRIM(doctor), ''),
                    NULLIF(TRIM(service), ''),
                    ARRAY_REMOVE(ARRAY[NULLIF(TRIM(ktv1), ''), NULLIF(TRIM(ktv2), '')], NULL) as ktv_names,
                    CASE WHEN so_ktv = 2 THEN 0.50 ELSE 1.00 END as tour_credit,
                    TRUE as is_valid,
                    'VALID' as status,
                    '[Import] ' || TRIM(customer_name) || ' | ' || COALESCE(service, '') as raw_text,
                    created_at,
                    updated_at
                FROM uk_tour_records
                WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
                ORDER BY record_date ASC, id ASC
            `);
            console.log(`Successfully synced ${insertRes.rowCount} tour reports into ktv_tour_reports!`);
        } else {
            console.log('ktv_tour_reports already has records, skipping sync.');
        }

        // Also check recent tours query
        const recent = await pool.query(`
            SELECT id, report_date, customer_name, phone, ktv_names, tour_credit 
            FROM ktv_tour_reports 
            ORDER BY report_date DESC, id DESC 
            LIMIT 5
        `);
        console.log('Top 5 recent tour reports in database:');
        console.table(recent.rows);
    } catch (e) {
        console.error('Error syncing tour reports:', e);
    } finally {
        await pool.end();
    }
}

run();
