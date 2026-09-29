/**
 * Cổng ghi Google Sheets dùng chung cho cả bot và api.
 *
 * Toàn bộ dự án chỉ tạo GoogleSpreadsheet tại apps/bot/sheetManager.js, nên
 * installSheetWriteGate() chỉ cần vá prototype của thư viện google-spreadsheet
 * một lần là mọi đường ghi (chấm công, KPI, retail, warehouse, scheduling...)
 * đều đi qua cổng này.
 *
 * Cổng làm hai việc:
 *  - Giới hạn tốc độ ghi bằng token bucket (mặc định 35 lệnh/phút, thấp hơn
 *    hạn mức ~60 lệnh ghi/phút của Google cho tài khoản consumer) để không
 *    nổ quota khi nhiều người check-in cùng lúc.
 *  - Khi vẫn gặp lỗi 429, tự thử lại với exponential backoff (có jitter)
 *    thay vì bỏ mất dữ liệu như trước đây.
 */

import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';

const WORKSHEET_WRITE_METHODS = [
    'clearRows', 'clear', 'addRows', 'addRow', 'setHeaderRow',
    'saveUpdatedCells', 'updateProperties', 'resize', 'delete'
];

const DOC_WRITE_METHODS = ['addSheet', 'deleteSheet', 'updateProperties', 'delete'];

function configFromEnv() {
    return {
        writesPerMinute: Number(process.env.SHEET_WRITES_PER_MIN || 35),
        maxRetries: Number(process.env.SHEET_WRITE_MAX_RETRIES || 3),
        backoffBaseMs: Number(process.env.SHEET_WRITE_BACKOFF_BASE_MS || 1000)
    };
}

export function createSheetWriteGate({
    writesPerMinute = 35,
    maxRetries = 3,
    backoffBaseMs = 1000,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = (...args) => console.warn(...args)
} = {}) {
    let tokens = writesPerMinute;
    let lastRefill = now();
    const recentWrites = [];
    const refillPerMs = writesPerMinute / 60000;

    async function acquireSlot() {
        for (;;) {
            const t = now();
            const elapsed = t - lastRefill;
            lastRefill = t;
            tokens = Math.min(writesPerMinute, tokens + elapsed * refillPerMs);
            if (tokens >= 1) {
                tokens -= 1;
                return;
            }
            const waitMs = Math.ceil((1 - tokens) / refillPerMs);
            await sleep(waitMs);
        }
    }

    function isQuotaError(err) {
        if (!err) return false;
        if (err?.response?.status === 429) return true;
        const msg = String(err?.message || err?.code || '');
        return msg.includes('[429]') || /quota/i.test(msg);
    }

    function getStats() {
        const cutoff = now() - 60000;
        while (recentWrites.length > 0 && recentWrites[0] < cutoff) recentWrites.shift();
        return { writesLast60s: recentWrites.length, tokensLeft: Math.floor(tokens) };
    }

    async function run(fn) {
        let lastErr;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            await acquireSlot();
            try {
                const result = await fn();
                recentWrites.push(now());
                return result;
            } catch (err) {
                lastErr = err;
                if (!isQuotaError(err) || attempt >= maxRetries) throw err;
                const jitter = Math.random() * Math.max(200, backoffBaseMs / 2);
                const delay = backoffBaseMs * 2 ** attempt + jitter;
                log(`[SHEET GATE] Lỗi 429 quota Google Sheets — chờ ${Math.round(delay)}ms rồi thử lại (lần ${attempt + 1}/${maxRetries}). ${JSON.stringify(getStats())}`);
                await sleep(delay);
            }
        }
        throw lastErr;
    }

    return { run, getStats };
}

let defaultGate = null;

function getDefaultGate() {
    if (!defaultGate) defaultGate = createSheetWriteGate(configFromEnv());
    return defaultGate;
}

/**
 * Cho các đường ghi dùng thẳng googleapis (không qua google-spreadsheet)
 * đi qua cùng một cổng.
 */
export function runGatedWrite(fn) {
    return getDefaultGate().run(fn);
}

let installed = false;

/**
 * Vá prototype của google-spreadsheet để mọi lệnh ghi đi qua cổng.
 * Idempotent — gọi nhiều lần (bot + api đều import sheetManager) vẫn an toàn.
 */
export function installSheetWriteGate() {
    if (installed) return;
    installed = true;

    const gate = getDefaultGate();

    for (const name of WORKSHEET_WRITE_METHODS) {
        const original = GoogleSpreadsheetWorksheet.prototype[name];
        if (typeof original !== 'function') continue;
        GoogleSpreadsheetWorksheet.prototype[name] = function (...args) {
            return gate.run(() => original.apply(this, args));
        };
    }

    for (const name of DOC_WRITE_METHODS) {
        const original = GoogleSpreadsheet.prototype[name];
        if (typeof original !== 'function') continue;
        GoogleSpreadsheet.prototype[name] = function (...args) {
            return gate.run(() => original.apply(this, args));
        };
    }

    const { writesPerMinute, maxRetries } = configFromEnv();
    console.log(`[SHEET GATE] Đã bật cổng ghi Google Sheets: tối đa ${writesPerMinute} lệnh/phút, retry 429 tối đa ${maxRetries} lần.`);
}
