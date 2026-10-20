import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRowsHash, createSheetSyncState } from './sheet-sync-state.js';

test('computeRowsHash ổn định và khác nhau khi nội dung đổi', () => {
    assert.equal(computeRowsHash([{ a: 1, b: 'x' }]), computeRowsHash([{ a: 1, b: 'x' }]));
    assert.notEqual(computeRowsHash([{ a: 1 }]), computeRowsHash([{ a: 2 }]));
    assert.notEqual(computeRowsHash([{ a: 1 }]), computeRowsHash([]));
    assert.equal(computeRowsHash([]), computeRowsHash([]));
});

function makeFakePool() {
    const store = new Map();
    return {
        async query(sql, params) {
            if (sql.includes('INSERT INTO sheet_sync_state')) {
                store.set(params[0], params[1]);
            } else if (sql.includes('SELECT content_hash')) {
                const hash = store.get(params[0]);
                return { rows: hash === undefined ? [] : [{ content_hash: hash }] };
            }
            return { rows: [] };
        }
    };
}

test('hasSameContent/saveContent: bỏ qua khi hash trùng, ghi khi khác', async () => {
    const state = createSheetSyncState({ pool: makeFakePool() });
    assert.equal(await state.hasSameContent('key1', 'hash1'), false);
    await state.saveContent('key1', 'hash1');
    assert.equal(await state.hasSameContent('key1', 'hash1'), true);
    assert.equal(await state.hasSameContent('key1', 'hash2'), false);
    await state.saveContent('key1', 'hash2');
    assert.equal(await state.hasSameContent('key1', 'hash2'), true);
});

test('fail-open khi DB lỗi: trả false để vẫn ghi, saveContent không ném', async () => {
    const state = createSheetSyncState({
        pool: {
            async query() {
                throw new Error('db down');
            }
        }
    });
    assert.equal(await state.hasSameContent('key1', 'hash1'), false);
    await state.saveContent('key1', 'hash1');
});
