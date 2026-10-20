import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSpreadsheet, GoogleSpreadsheetWorksheet } from 'google-spreadsheet';
import { createSheetWriteGate, installSheetWriteGate } from './sheet-write-gate.js';

function makeFakeClock() {
    let t = 0;
    return {
        now: () => t,
        sleep: async (ms) => { t += ms; }
    };
}

const silentLog = () => {};

test('giới hạn tốc độ: 6 lệnh đầu đi ngay, lệnh thứ 7 chờ đủ 1 token', async () => {
    const clock = makeFakeClock();
    const gate = createSheetWriteGate({ writesPerMinute: 6, now: clock.now, sleep: clock.sleep, log: silentLog });
    const calls = [];
    for (let i = 0; i < 7; i++) {
        await gate.run(() => { calls.push(clock.now()); return i; });
    }
    assert.deepEqual(calls.slice(0, 6), [0, 0, 0, 0, 0, 0]);
    assert.equal(calls[6], 10000);
});

test('thử lại với backoff khi gặp 429 rồi thành công', async () => {
    const clock = makeFakeClock();
    const gate = createSheetWriteGate({
        writesPerMinute: 1000, maxRetries: 3, backoffBaseMs: 1000,
        now: clock.now, sleep: clock.sleep, log: silentLog
    });
    let attempts = 0;
    const result = await gate.run(() => {
        attempts += 1;
        if (attempts < 3) throw new Error('Google API error - [429] Quota exceeded for quota metric');
        return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
});

test('nhận diện 429 qua response.status', async () => {
    const clock = makeFakeClock();
    const gate = createSheetWriteGate({
        writesPerMinute: 1000, maxRetries: 2, backoffBaseMs: 1000,
        now: clock.now, sleep: clock.sleep, log: silentLog
    });
    let attempts = 0;
    const err429 = new Error('boom');
    err429.response = { status: 429 };
    const result = await gate.run(() => {
        attempts += 1;
        if (attempts === 1) throw err429;
        return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(attempts, 2);
});

test('không retry lỗi không phải quota', async () => {
    const clock = makeFakeClock();
    const gate = createSheetWriteGate({
        writesPerMinute: 1000, maxRetries: 3, backoffBaseMs: 1000,
        now: clock.now, sleep: clock.sleep, log: silentLog
    });
    let attempts = 0;
    await assert.rejects(
        gate.run(() => {
            attempts += 1;
            throw new Error('Google API error - [400] Bad Request');
        }),
        /\[400\]/
    );
    assert.equal(attempts, 1);
});

test('hết số lần retry thì ném lỗi cuối cùng', async () => {
    const clock = makeFakeClock();
    const gate = createSheetWriteGate({
        writesPerMinute: 1000, maxRetries: 3, backoffBaseMs: 1000,
        now: clock.now, sleep: clock.sleep, log: silentLog
    });
    let attempts = 0;
    await assert.rejects(
        gate.run(() => {
            attempts += 1;
            throw new Error('Google API error - [429] Quota exceeded');
        }),
        /\[429\]/
    );
    assert.equal(attempts, 4);
});

test('getStats đếm số lệnh ghi trong 60s gần đây', async () => {
    const clock = makeFakeClock();
    const gate = createSheetWriteGate({ writesPerMinute: 1000, now: clock.now, sleep: clock.sleep, log: silentLog });
    for (let i = 0; i < 3; i++) await gate.run(() => i);
    assert.equal(gate.getStats().writesLast60s, 3);
    await clock.sleep(61000);
    assert.equal(gate.getStats().writesLast60s, 0);
});

test('installSheetWriteGate vá prototype, idempotent', () => {
    installSheetWriteGate();
    installSheetWriteGate();
    assert.equal(typeof GoogleSpreadsheetWorksheet.prototype.clearRows, 'function');
    assert.equal(typeof GoogleSpreadsheetWorksheet.prototype.addRows, 'function');
    assert.equal(typeof GoogleSpreadsheet.prototype.addSheet, 'function');
    assert.equal(typeof GoogleSpreadsheet.prototype.loadInfo, 'function');
});
