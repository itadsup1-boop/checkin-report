import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseGuitinCommand, createMessagingService,
    MAX_BULK_RECIPIENTS, MAX_MESSAGE_LENGTH
} from '../application/messaging-service.js';

function createMocks() {
    const calls = {
        findEmployeesByCodes: [], logDirectMessage: [],
        enqueueOutbox: [], setDirectMessageOutbox: []
    };
    const employees = {
        NV001: { id: 'e1', employee_code: 'NV001', full_name: 'Nguyễn Văn A', telegram_id: '111' },
        NV002: { id: 'e2', employee_code: 'NV002', full_name: 'Trần B', telegram_id: '222' },
        NV003: { id: 'e3', employee_code: 'NV003', full_name: 'Lê C', telegram_id: null },
        NV004: { id: 'e4', employee_code: 'NV004', full_name: 'Phạm D', telegram_id: '333' },
        NV005: { id: 'e5', employee_code: 'NV005', full_name: 'Hoàng E', telegram_id: '111' }
    };
    const taskRepository = {
        async findEmployeesByCodes(codes) {
            calls.findEmployeesByCodes.push(codes);
            return codes.map(c => employees[c]).filter(Boolean);
        },
        async enqueueOutbox(input) {
            calls.enqueueOutbox.push(input);
            return { id: 900 + calls.enqueueOutbox.length, ...input };
        }
    };
    const messagingRepository = {
        async logDirectMessage(input) {
            calls.logDirectMessage.push(input);
            return 700 + calls.logDirectMessage.length;
        },
        async setDirectMessageOutbox(logId, outboxId) {
            calls.setDirectMessageOutbox.push({ logId, outboxId });
        },
        async markDirectMessageSent() {},
        async listDirectMessagesByManager() { return []; }
    };
    return { taskRepository, messagingRepository, calls };
}

function createService(mocks) {
    return createMessagingService({
        taskRepository: mocks.taskRepository,
        messagingRepository: mocks.messagingRepository
    });
}

test('parseGuitinCommand đọc mã + nội dung, giữ ký tự | trong tin nhắn', () => {
    const parsed = parseGuitinCommand('/guitin NV001,NV002 | Gọi A | rồi báo lại | trước 17:00');
    assert.deepEqual(parsed, {
        codes: ['NV001', 'NV002'],
        content: 'Gọi A | rồi báo lại | trước 17:00'
    });
});

test('parseGuitinCommand chuẩn hoá mã in thường và khoảng trắng', () => {
    const parsed = parseGuitinCommand('/guitinall  nv001 , nv002 |Nội dung');
    assert.deepEqual(parsed, { codes: ['NV001', 'NV002'], content: 'Nội dung' });
});

test('parseGuitinCommand báo lỗi cú pháp khi thiếu mã hoặc nội dung', () => {
    assert.ok(parseGuitinCommand('/guitin').error);
    assert.ok(parseGuitinCommand('/guitin NV001').error);
    assert.ok(parseGuitinCommand('/guitin NV001 | ').error);
    assert.ok(parseGuitinCommand('/guitin | nội dung').error);
});

test('prepareMessage trả người nhận hợp lệ, tách missing/unreachable/trùng chat', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const prepared = await service.prepareMessage({
        managerId: '888',
        codes: 'NV001, nv003, NV004, NV999',
        text: 'Nhớ nộp báo cáo'
    });
    assert.equal(prepared.content, 'Nhớ nộp báo cáo');
    assert.equal(prepared.recipients.length, 2);
    assert.equal(prepared.recipients[0].employee_code, 'NV001');
    assert.equal(prepared.recipients[1].employee_code, 'NV004');
    assert.deepEqual(prepared.missing, ['NV999']);
    assert.deepEqual(prepared.unreachable, ['NV003']);
    assert.deepEqual(prepared.duplicates, []);
});

test('prepareMessage gộp mã trùng Telegram ID thành 1 người nhận', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const prepared = await service.prepareMessage({
        managerId: '888', codes: 'NV001,NV005', text: 'Chào anh'
    });
    assert.equal(prepared.recipients.length, 1);
    assert.deepEqual(prepared.duplicates, ['NV005']);
});

test('prepareMessage từ chối nội dung rỗng, quá dài, quá nhiều người nhận', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    await assert.rejects(
        () => service.prepareMessage({ managerId: '888', codes: 'NV001', text: '   ' }),
        err => err.code === 'TEXT_REQUIRED'
    );
    await assert.rejects(
        () => service.prepareMessage({ managerId: '888', codes: 'NV001', text: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) }),
        err => err.code === 'TEXT_TOO_LONG'
    );
    const manyCodes = Array.from({ length: MAX_BULK_RECIPIENTS + 1 }, (_, i) => `NV${i}`).join(',');
    await assert.rejects(
        () => service.prepareMessage({ managerId: '888', codes: manyCodes, text: 'xin chào' }),
        err => err.code === 'TOO_MANY_RECIPIENTS'
    );
});

test('prepareMessage từ chối khi không ai có Telegram ID', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    await assert.rejects(
        () => service.prepareMessage({ managerId: '888', codes: 'NV003', text: 'xin chào' }),
        err => err.code === 'NO_REACHABLE_RECIPIENT'
    );
});

test('confirmSend ghi nhật ký + outbox + nối outbox id cho từng người nhận', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    const recipients = [
        { id: 'e1', employee_code: 'NV001', full_name: 'Nguyễn Văn A', telegram_id: '111' },
        { id: 'e2', employee_code: 'NV002', full_name: 'Trần B', telegram_id: '222' }
    ];
    const result = await service.confirmSend({ managerId: '888', recipients, text: 'Nhớ nộp báo cáo' });

    assert.equal(mocks.calls.logDirectMessage.length, 2);
    assert.equal(mocks.calls.enqueueOutbox.length, 2);

    assert.equal(mocks.calls.logDirectMessage[0].managerId, '888');
    assert.equal(mocks.calls.logDirectMessage[0].employeeCode, 'NV001');
    assert.equal(mocks.calls.logDirectMessage[0].chatId, '111');
    assert.equal(mocks.calls.logDirectMessage[0].text, 'Nhớ nộp báo cáo');

    const firstOutbox = mocks.calls.enqueueOutbox[0];
    assert.match(firstOutbox.deduplicationKey, /^dmsg:[0-9a-f-]{36}$/);
    assert.equal(firstOutbox.chatId, '111');
    assert.equal(firstOutbox.linkMeta.direction, 'DIRECT_MESSAGE');
    assert.equal(firstOutbox.linkMeta.directMessageLogId, 701);

    assert.deepEqual(mocks.calls.setDirectMessageOutbox, [
        { logId: 701, outboxId: 901 },
        { logId: 702, outboxId: 902 }
    ]);

    assert.equal(result.results.length, 2);
    assert.equal(result.results[0].outboxId, 901);
    assert.ok(result.sentAt instanceof Date);
});

test('confirmSend từ chối khi thiếu nội dung hoặc không có người nhận', async () => {
    const mocks = createMocks();
    const service = createService(mocks);
    await assert.rejects(
        () => service.confirmSend({ managerId: '888', recipients: [{ id: 'e1' }], text: '' }),
        err => err.code === 'TEXT_REQUIRED'
    );
    await assert.rejects(
        () => service.confirmSend({ managerId: '888', recipients: [], text: 'chào' }),
        err => err.code === 'NO_RECIPIENT'
    );
    assert.equal(mocks.calls.logDirectMessage.length, 0);
});
