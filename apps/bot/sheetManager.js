import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../../packages/database/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const credsPath = path.join(__dirname, '../../hybrid-flame-499905-r2-ccd6aff86787.json');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

const serviceAccountAuth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const docsCache = {};

export async function getDocById(spreadsheetId) {
    if (!spreadsheetId || spreadsheetId === 'SPREADSHEET_ID_CHUA_CAI_DAT') return null;
    if (!docsCache[spreadsheetId]) {
        const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
        docsCache[spreadsheetId] = doc;
    }
    return docsCache[spreadsheetId];
}

export async function getKpiDocForGroup(telegram_group_id) {
    if (telegram_group_id) {
        const res = await pool.query('SELECT kpi_sheet_id FROM telegram_groups WHERE telegram_group_id = $1', [telegram_group_id]);
        if (res.rows.length > 0 && res.rows[0].kpi_sheet_id) {
            return await getDocById(res.rows[0].kpi_sheet_id);
        }
    }
    return await getDocById(process.env.GOOGLE_SPREADSHEET_ID || 'SPREADSHEET_ID_CHUA_CAI_DAT');
}

export async function getCustomerDocForGroup(telegram_group_id) {
    if (telegram_group_id) {
        const res = await pool.query('SELECT customer_sheet_id FROM telegram_groups WHERE telegram_group_id = $1', [telegram_group_id]);
        if (res.rows.length > 0 && res.rows[0].customer_sheet_id) {
            return await getDocById(res.rows[0].customer_sheet_id);
        }
    }
    return await getDocById(process.env.CUSTOMER_SPREADSHEET_ID);
}

// Hàm hỗ trợ tìm group id từ employee telegram_id
export async function getGroupIdFromTelegramId(telegram_id) {
    const res = await pool.query('SELECT telegram_group_id FROM employees WHERE telegram_id = $1 LIMIT 1', [telegram_id.toString()]);
    if (res.rows.length > 0) return res.rows[0].telegram_group_id;
    return null;
}
