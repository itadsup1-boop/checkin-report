/**
 * Ghi bản xuất chấm công cuối ngày lên Google Sheet.
 *
 * Ghi ĐÈ từ ô A1 của trang `DailyExport` — mỗi đêm thay toàn bộ nội dung cũ, đây
 * là ảnh chụp trong ngày chứ không phải nhật ký cộng dồn.
 */

import { google } from 'googleapis';

const SHEET_RANGE = 'DailyExport!A1';

export function createDailyExportSheet({ spreadsheetId }) {
    async function writeDailyExport(rows) {
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets']
        });
        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: authClient });

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: SHEET_RANGE,
            valueInputOption: 'RAW',
            requestBody: { values: rows }
        });
    }

    return { writeDailyExport, SHEET_RANGE };
}
