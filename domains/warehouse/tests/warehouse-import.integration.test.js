import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import moment from 'moment';
import pool from '../../../packages/database/index.js';
import { registerWarehouseImportRoutes } from '../interfaces/miniapp-api/import-routes.js';
import { startWarehouseOutboxWorker } from '../infrastructure/outbox/outbox-worker.js';

test('nhập kho trả lời sớm và outbox chỉ xóa ảnh sau khi đồng bộ thành công', async t => {
    const originalConsoleError = console.error;
    console.error = (...args) => {
        if (args[0] !== '[Warehouse Outbox]') originalConsoleError(...args);
    };
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const telegramGroupId = `-998${String(Date.now()).slice(-9)}`;
    const telegramId = `77${String(Date.now()).slice(-8)}`;
    const barcode = `IMPORT-${suffix}`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-import-'));
    const imagePath = path.join(tempDir, 'proof.jpg');
    fs.writeFileSync(imagePath, Buffer.from('fake-image-content'));
    let groupId;
    let employeeId;
    let productId;
    let transactionId;
    let worker;

    t.after(async () => {
        console.error = originalConsoleError;
        worker?.stop();
        await pool.query(
            `DELETE FROM tk_warehouse_outbox
             WHERE aggregate_type = 'WAREHOUSE_IMPORT'
               AND aggregate_id IN (
                 SELECT id FROM tk_warehouse_transactions WHERE group_id = $1
               )`,
            [groupId]
        );
        if (transactionId) {
            await pool.query('DELETE FROM tk_warehouse_ledger WHERE legacy_transaction_id = $1', [transactionId]);
            await pool.query('DELETE FROM tk_warehouse_transactions WHERE id = $1', [transactionId]);
        }
        if (productId) {
            await pool.query('DELETE FROM tk_inventory WHERE product_id = $1', [productId]);
            await pool.query('DELETE FROM tk_products WHERE id = $1', [productId]);
        }
        if (employeeId) await pool.query('DELETE FROM employees WHERE id = $1', [employeeId]);
        if (groupId) await pool.query('DELETE FROM telegram_groups WHERE id = $1', [groupId]);
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
        if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
        await pool.end();
    });

    const group = await pool.query(
        `INSERT INTO telegram_groups
            (telegram_group_id, group_name, bot_role, is_active, is_deleted,
             customer_drive_folder_id)
         VALUES ($1, $2, 'warehouse', TRUE, FALSE, 'fake-parent-folder')
         RETURNING id`,
        [telegramGroupId, `Import integration ${suffix}`]
    );
    groupId = group.rows[0].id;
    const employee = await pool.query(
        `INSERT INTO employees
            (employee_code, full_name, telegram_id, telegram_group_id,
             department, position, role, is_active)
         VALUES ($1, 'Nhân viên nhập kho test', $2, $3,
                 'Warehouse', 'Staff', 'Nhân viên', TRUE)
         RETURNING id`,
        [`WH-IMPORT-${suffix}`, telegramId, telegramGroupId]
    );
    employeeId = employee.rows[0].id;

    let routeHandler;
    const botApp = {
        post(route, ...handlers) {
            assert.equal(route, '/api/warehouse/import');
            routeHandler = handlers.at(-1);
        }
    };
    registerWarehouseImportRoutes({
        botApp,
        pool,
        authenticateTelegramMiniApp: () => {},
        receiveWarehouseImages: () => {}
    });

    let statusCode = 200;
    let responseBody;
    const req = {
        verifiedTelegramId: telegramId,
        files: [{
            path: imagePath,
            originalname: 'proof.jpg',
            mimetype: 'image/jpeg',
            size: fs.statSync(imagePath).size
        }],
        body: {
            chat_id: telegramGroupId,
            branch: 'UK',
            items: JSON.stringify([{
                barcode,
                product_name: `Sản phẩm nhập test ${suffix}`,
                quantity: 4
            }])
        }
    };
    const res = {
        status(value) {
            statusCode = value;
            return this;
        },
        json(value) {
            responseBody = value;
            return value;
        }
    };

    await routeHandler(req, res);
    assert.equal(statusCode, 200);
    assert.equal(responseBody.success, true);
    assert.match(responseBody.message, /đồng bộ nền/i);
    assert.equal(fs.existsSync(imagePath), true);
    transactionId = responseBody.transaction_group_id;

    const stateAfterResponse = await pool.query(
        `SELECT p.id AS product_id, i.quantity, t.proof_folder_url,
                l.quantity_delta, o.status AS outbox_status
         FROM tk_warehouse_transactions t
         JOIN tk_products p ON p.id = t.product_id
         JOIN tk_inventory i ON i.product_id = p.id AND i.branch = 'UK'
         JOIN tk_warehouse_ledger l ON l.legacy_transaction_id = t.id
         JOIN tk_warehouse_outbox o ON o.aggregate_id = t.id
         WHERE t.id = $1`,
        [transactionId]
    );
    productId = stateAfterResponse.rows[0].product_id;
    assert.equal(stateAfterResponse.rows[0].quantity, 4);
    assert.equal(stateAfterResponse.rows[0].quantity_delta, 4);
    assert.equal(stateAfterResponse.rows[0].proof_folder_url, null);
    assert.equal(stateAfterResponse.rows[0].outbox_status, 'PENDING');

    let uploadCount = 0;
    let notificationCount = 0;
    let sheetSyncCount = 0;
    let allowNotification = false;
    worker = startWarehouseOutboxWorker({
        pool,
        bot: {},
        sendMessageToRoleGroup: async () => null,
        sendMediaGroupToRoleGroup: async () => {
            notificationCount += 1;
            return allowNotification ? { message_id: 1 } : null;
        },
        warehouseOrderService: { repository: {} },
        syncWarehouseOrder: async () => {},
        syncWarehouseSheets: async () => { sheetSyncCount += 1; },
        fs,
        moment,
        createWarehouseFolder: async () => ({
            id: 'fake-drive-folder',
            webViewLink: 'https://drive.test/fake-drive-folder'
        }),
        uploadToDrive: async buffer => {
            assert.equal(buffer.toString(), 'fake-image-content');
            uploadCount += 1;
        },
        escapeHtml: value => String(value),
        autoStart: false
    });
    await worker.runOnce();

    const failedAttempt = await pool.query(
        `SELECT status, attempts, payload
         FROM tk_warehouse_outbox
         WHERE aggregate_id = $1`,
        [transactionId]
    );
    assert.equal(failedAttempt.rows[0].status, 'PENDING');
    assert.equal(failedAttempt.rows[0].attempts, 1);
    assert.deepEqual(failedAttempt.rows[0].payload.uploadedFileIndexes, [0]);
    assert.equal(uploadCount, 1);
    assert.equal(notificationCount, 1);
    assert.equal(sheetSyncCount, 0);
    assert.equal(fs.existsSync(imagePath), true);

    allowNotification = true;
    await pool.query(
        'UPDATE tk_warehouse_outbox SET next_retry_at = NOW() WHERE aggregate_id = $1',
        [transactionId]
    );
    await worker.runOnce();

    const stateAfterWorker = await pool.query(
        `SELECT t.proof_folder_url, l.proof_folder_url AS ledger_proof,
                o.status AS outbox_status, o.processed_at
         FROM tk_warehouse_transactions t
         JOIN tk_warehouse_ledger l ON l.legacy_transaction_id = t.id
         JOIN tk_warehouse_outbox o ON o.aggregate_id = t.id
         WHERE t.id = $1`,
        [transactionId]
    );
    assert.equal(uploadCount, 1);
    assert.equal(notificationCount, 2);
    assert.equal(sheetSyncCount, 1);
    assert.equal(stateAfterWorker.rows[0].proof_folder_url, 'https://drive.test/fake-drive-folder');
    assert.equal(stateAfterWorker.rows[0].ledger_proof, 'https://drive.test/fake-drive-folder');
    assert.equal(stateAfterWorker.rows[0].outbox_status, 'DONE');
    assert.ok(stateAfterWorker.rows[0].processed_at);
    assert.equal(fs.existsSync(imagePath), false);
});
