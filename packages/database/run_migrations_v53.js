import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_TELESALE_FIELDS = [
    { key: 'so_nhan', label: 'Số data nhận', type: 'number', category: 'INPUT', default: 0, required: true, is_monthly_cumulative: false, is_hidden: false, order_index: 1 },
    { key: 'so_trung_knc_vang', label: 'Số trùng / KNC / Văng', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 2 },
    { key: 'lich_pv_moi', label: 'Số lịch PV mới', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 3 },
    { key: 'lich_pv_cu', label: 'Số lịch PV cũ', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 4 },
    { key: 'lich_ngay_mai', label: 'Lịch hẹn ngày mai', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 5 },
    { key: 'tong_toi_hnay', label: 'Tổng tới hôm nay', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 6 },
    { key: 'tong_bong_hnay', label: 'Tổng bong hôm nay', type: 'number', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 7 },
    { key: 'tong_ds_hnay', label: 'TỔNG DS hôm nay', type: 'currency', category: 'INPUT', default: 0, required: false, is_monthly_cumulative: false, is_hidden: false, order_index: 8 },
    { key: 'tong_lich', label: 'Tổng lịch cộng dồn', type: 'number', category: 'CALCULATED', formula: '{lich_pv_moi} + {lich_pv_cu}', is_monthly_cumulative: false, is_hidden: false, order_index: 9 },
    { key: 'tong_ds_thang', label: 'Tổng DS cộng dồn tháng', type: 'currency', category: 'CALCULATED', formula: '{tong_ds_hnay}', is_monthly_cumulative: true, is_hidden: false, order_index: 10 },
    { key: 'tong_toi', label: 'Tổng khách tới cộng dồn', type: 'number', category: 'CALCULATED', formula: '{tong_toi_hnay}', is_monthly_cumulative: false, is_hidden: false, order_index: 11 },
    { key: 'ty_le_khach_toi_ds', label: 'Tỷ lệ khách tới / Doanh số', type: 'currency', category: 'CALCULATED', formula: '{tong_ds_hnay} / {tong_toi_hnay}', is_monthly_cumulative: false, is_hidden: false, order_index: 12 },
    { key: 'ty_le_lich', label: 'Tỷ lệ lịch cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_lich} / {so_nhan}) * 100', is_monthly_cumulative: false, is_hidden: false, order_index: 13, thresholds: [
        { operator: '<', value: 25, badge: '⚠️ (Cảnh báo < 25%)', type: 'warning' }
    ]},
    { key: 'ty_le_toi', label: 'Tỉ lệ tới cộng dồn', type: 'percentage', category: 'CALCULATED', formula: '({tong_toi} / {so_nhan}) * 100', is_monthly_cumulative: false, is_hidden: false, order_index: 14, thresholds: [
        { operator: '>=', value: 19, badge: '🌟 (Khen thưởng > 19%)', type: 'reward' },
        { operator: '<', value: 15, badge: '⚠️ (Cảnh báo < 15%)', type: 'warning' }
    ]}
];

export const DEFAULT_SCHEDULE_SETTINGS = {
    remind_enabled: true,
    remind_time: '18:00',
    deadline_time: '19:00',
    penalty_enabled: true,
    penalty_amount: 50000,
    summary_enabled: true,
    summary_time: '19:01',
    summary_fields: ['so_nhan', 'so_trung_knc_vang', 'tong_lich', 'tong_toi', 'lich_ngay_mai', 'tong_ds_hnay', 'tong_ds_thang', 'ty_le_lich', 'ty_le_toi']
};

async function run() {
    const sqlPath = path.join(__dirname, 'migrations', 'v53_telesale_dynamic_form_configs.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Migration v53 executed successfully.');

    // Seed default config for existing telesale groups if they don't have one
    const telesaleGroups = await pool.query(`
        SELECT telegram_group_id, group_name
        FROM telegram_groups
        WHERE bot_role = 'telesale'
    `);

    for (const g of telesaleGroups.rows) {
        await pool.query(`
            INSERT INTO telesale_form_configs (telegram_group_id, group_name, fields, schedule_settings)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (telegram_group_id) DO UPDATE
            SET group_name = EXCLUDED.group_name,
                updated_at = NOW()
        `, [
            g.telegram_group_id,
            g.group_name,
            JSON.stringify(DEFAULT_TELESALE_FIELDS),
            JSON.stringify(DEFAULT_SCHEDULE_SETTINGS)
        ]);
        console.log(`Seeded default config for group ${g.group_name} (${g.telegram_group_id})`);
    }

    await pool.end();
}

run().catch(err => {
    console.error('Migration v53 failed:', err);
    process.exit(1);
});
