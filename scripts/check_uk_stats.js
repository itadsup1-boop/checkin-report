import 'dotenv/config';
import pool from '../packages/database/index.js';

async function checkUkStats() {
    console.log('--- UK KTV Statistics in September 2026 ---');
    const ktvs = await pool.query(`
        SELECT unnest(ktv_names) as ktv, count(id) as tour_count, sum(tour_credit) as total_credit 
        FROM ktv_tour_reports 
        WHERE group_id = '-1002228375063' AND report_date >= '2026-09-01'
        GROUP BY 1 
        ORDER BY 3 DESC
    `);
    console.table(ktvs.rows);

    const total = await pool.query(`
        SELECT count(id) as total_tours, sum(tour_credit) as total_credit
        FROM ktv_tour_reports
        WHERE group_id = '-1002228375063' AND report_date >= '2026-09-01'
    `);
    console.log('UK September Total:', total.rows[0]);

    console.log('--- All Time UK KTV Statistics ---');
    const allKtvs = await pool.query(`
        SELECT unnest(ktv_names) as ktv, count(id) as tour_count, sum(tour_credit) as total_credit 
        FROM ktv_tour_reports 
        WHERE group_id = '-1002228375063'
        GROUP BY 1 
        ORDER BY 3 DESC
    `);
    console.table(allKtvs.rows);

    process.exit(0);
}

checkUkStats().catch(e => {
    console.error(e);
    process.exit(1);
});
