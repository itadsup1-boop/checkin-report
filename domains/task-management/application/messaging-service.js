import { randomUUID } from 'node:crypto';

function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}

export const MAX_BULK_RECIPIENTS = 50;
export const MAX_MESSAGE_LENGTH = 3000;

// /guitin NV001,NV002 | nội dung — nội dung được giữ nguyên kể cả khi có ký tự "|"
export function parseGuitinCommand(text) {
    const body = String(text).trim().replace(/^\/guitin(all)?\s*/i, '');
    if (!body) {
        return { error: 'Cú pháp: /guitin NV001,NV002 | nội dung tin nhắn\nVí dụ: /guitin NV001 | Anh nhớ nộp báo cáo doanh số trước 17:00' };
    }
    const parts = body.split('|');
    const codesPart = parts[0].trim();
    const content = parts.slice(1).join('|').trim();
    if (!codesPart || !content) {
        return { error: 'Cú pháp: /guitin NV001,NV002 | nội dung tin nhắn\nVí dụ: /guitin NV001 | Anh nhớ nộp báo cáo doanh số trước 17:00' };
    }
    const codes = codesPart.toUpperCase().split(/[\s,]+/).filter(Boolean);
    if (!codes.length) return { error: 'Thiếu mã nhân viên.' };
    return { codes, content };
}

export function createMessagingService({ taskRepository, messagingRepository, now = () => new Date() }) {
    // Giải mã nhân viên + lọc người nhận được: trả danh sách reachable để handlers
    // hiển thị preview trước khi gửi thật.
    async function prepareMessage({ managerId, codes = [], names = [], all = false, text }) {
        const content = String(text ?? '').trim();
        if (!content) fail('TEXT_REQUIRED', 'Thiếu nội dung tin nhắn.');
        if (content.length > MAX_MESSAGE_LENGTH) {
            fail('TEXT_TOO_LONG', `Nội dung quá dài (${content.length}/${MAX_MESSAGE_LENGTH} ký tự).`);
        }
        const uniqueCodes = [...new Set(String(codes).split(/[\s,]+/).filter(Boolean).map(c => c.toUpperCase()))];
        const uniqueNames = [...new Set((Array.isArray(names) ? names : [names]).map(name => String(name).trim()).filter(Boolean))];
        if (!all && !uniqueCodes.length && !uniqueNames.length) fail('NO_RECIPIENT', 'Thiếu mã hoặc tên nhân viên.');
        if (!all && uniqueCodes.length + uniqueNames.length > MAX_BULK_RECIPIENTS) {
            fail('TOO_MANY_RECIPIENTS', `Tối đa ${MAX_BULK_RECIPIENTS} người nhận mỗi lần gửi.`);
        }

        const employees = all
            ? await taskRepository.findAllActiveEmployees()
            : uniqueCodes.length
                ? await taskRepository.findEmployeesByCodes(uniqueCodes)
                : await taskRepository.findEmployeesByNames(uniqueNames);
        if (employees.length > MAX_BULK_RECIPIENTS) {
            fail('TOO_MANY_RECIPIENTS', `Tối đa ${MAX_BULK_RECIPIENTS} người nhận mỗi lần gửi (hiện ${employees.length}).`);
        }
        const foundCodes = new Set(employees.map(e => e.employee_code.toUpperCase()));
        const foundNames = new Set(employees.map(e => e.full_name.toLowerCase()));
        const missing = all ? [] : uniqueCodes.length
            ? uniqueCodes.filter(c => !foundCodes.has(c))
            : uniqueNames.filter(name => ![...foundNames].some(found => found.includes(name.toLowerCase())));
        const reachableRaw = employees.filter(e => e.telegram_id);
        const unreachable = employees.filter(e => !e.telegram_id).map(e => e.employee_code);

        // Hai mã trùng Telegram ID thì chỉ gửi một lần
        const seenChats = new Set();
        const duplicates = [];
        const recipients = [];
        for (const e of reachableRaw) {
            const chatKey = String(e.telegram_id);
            if (seenChats.has(chatKey)) { duplicates.push(e.employee_code); continue; }
            seenChats.add(chatKey);
            recipients.push(e);
        }
        if (!recipients.length) {
            fail('NO_REACHABLE_RECIPIENT', 'Không ai trong danh sách có Telegram ID để nhận tin.');
        }
        return { managerId: String(managerId), content, recipients, missing, unreachable, duplicates };
    }

    // Gửi thật qua outbox; mỗi người nhận = 1 dòng nhật ký direct_message_logs,
    // outbox worker gửi xong sẽ ghi lại telegram_message_id (qua linkMeta).
    async function confirmSend({ managerId, recipients, text }) {
        const content = String(text ?? '').trim();
        if (!content) fail('TEXT_REQUIRED', 'Thiếu nội dung tin nhắn.');
        if (!recipients?.length) fail('NO_RECIPIENT', 'Không có người nhận hợp lệ nào.');
        const managerKey = String(managerId);
        const results = [];
        for (const recipient of recipients) {
            const logId = await messagingRepository.logDirectMessage({
                managerId: managerKey,
                employeeId: recipient.id,
                employeeCode: recipient.employee_code,
                employeeName: recipient.full_name,
                chatId: recipient.telegram_id,
                text: content
            });
            const outbox = await taskRepository.enqueueOutbox({
                deduplicationKey: `dmsg:${randomUUID()}`,
                chatId: recipient.telegram_id,
                text: content,
                linkMeta: {
                    direction: 'DIRECT_MESSAGE',
                    directMessageLogId: logId,
                    chatId: String(recipient.telegram_id)
                }
            });
            await messagingRepository.setDirectMessageOutbox(logId, outbox.id);
            results.push({
                logId, outboxId: outbox.id,
                employeeCode: recipient.employee_code,
                employeeName: recipient.full_name,
                chatId: String(recipient.telegram_id)
            });
        }
        return { sentAt: now(), results };
    }

    return { prepareMessage, confirmSend };
}
