/**
 * Trạng thái đồng bộ Google Sheets — bỏ qua lượt ghi khi nội dung không đổi.
 *
 * Mỗi sheet được định danh bằng sheet_key (VD "spreadsheetId:master" hoặc
 * "spreadsheetId:emp:<userId>"). Trước khi ghi, so hash của dữ liệu mới với
 * hash lần ghi gần nhất; trùng thì bỏ qua để không tốn lệnh ghi (quota Google).
 *
 * Mọi lỗi DB đều fail-open (coi như nội dung khác → vẫn ghi) để đồng bộ
 * không bao giờ bị hỏng vì tính năng này, kể cả khi migration chưa chạy.
 */

import crypto from 'node:crypto';

export function computeRowsHash(rows) {
    return crypto.createHash('sha1').update(JSON.stringify(rows ?? [])).digest('hex');
}

export function createSheetSyncState({ pool }) {
    let tableReady = false;

    async function ensureTable() {
        if (tableReady) return;
        await pool.query(`
            CREATE TABLE IF NOT EXISTS sheet_sync_state (
                sheet_key TEXT PRIMARY KEY,
                content_hash TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        `);
        tableReady = true;
    }

    async function hasSameContent(sheetKey, contentHash) {
        try {
            await ensureTable();
            const res = await pool.query(
                'SELECT content_hash FROM sheet_sync_state WHERE sheet_key = $1',
                [sheetKey]
            );
            return res.rows.length > 0 && res.rows[0].content_hash === contentHash;
        } catch (err) {
            console.error(`[SHEET SYNC STATE] Lỗi kiểm tra hash ${sheetKey}:`, err?.message);
            return false;
        }
    }

    async function saveContent(sheetKey, contentHash) {
        try {
            await ensureTable();
            await pool.query(`
                INSERT INTO sheet_sync_state (sheet_key, content_hash)
                VALUES ($1, $2)
                ON CONFLICT (sheet_key) DO UPDATE
                SET content_hash = EXCLUDED.content_hash, updated_at = now()
            `, [sheetKey, contentHash]);
        } catch (err) {
            console.error(`[SHEET SYNC STATE] Lỗi lưu hash ${sheetKey}:`, err?.message);
        }
    }

    return { hasSameContent, saveContent };
}
