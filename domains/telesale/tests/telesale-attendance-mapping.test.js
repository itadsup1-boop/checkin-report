import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createScanTelesaleDeadline } from '../application/scan-telesale-deadline.js';
import { createSendTelesaleReminder } from '../application/send-telesale-reminder.js';
import { buildTelesaleReminderMessage } from '../domain/telesale-messages.js';

describe('Telesale Attendance Mapping & Cross-Check Logic', () => {
    test('scanTelesaleDeadline bỏ qua nhân sự KHÔNG ĐI LÀM hôm nay (không có check-in), chỉ phạt người CÓ ĐI LÀM mà không nộp', async () => {
        const penalties = [];
        const tgNotices = [];

        // Mock danh sách nhân viên:
        // - emp-1: Đã nộp báo cáo -> bỏ qua
        // - emp-2: Có lịch OFF -> bỏ qua
        // - emp-3: Không đi làm hôm nay (hasWorkedToday = false) -> BỎ QUA KHÔNG PHẠT
        // - emp-4: Đi làm hôm nay (hasWorkedToday = true) nhưng chưa nộp -> BỊ PHẠT 50.000đ
        // - emp-5: Dùng tài khoản chung trên PC, đã đấu nối sang tài khoản cá nhân có đi làm (hasWorkedToday = true) -> BỊ PHẠT 50.000đ
        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-5400720656', group_name: '00. BC TELESALE' }
            ],
            findMembersInTelesaleGroup: async () => [
                { id: 'emp-1', full_name: 'Nguyễn Văn Đã Nộp', telegram_id: '111' },
                { id: 'emp-2', full_name: 'Trần Thị Nghỉ OFF', telegram_id: '222' },
                { id: 'emp-3', full_name: 'Lê Văn Không Đi Làm', telegram_id: '333', linked_employee_id: 'personal-emp-3' },
                { id: 'emp-4', full_name: 'Phạm Thị Có Đi Làm', telegram_id: '444' },
                { id: 'emp-5', full_name: 'Trịnh Khánh Phương', telegram_id: '7812616093', linked_employee_id: 'personal-phuong', linked_telegram_id: '999888' }
            ],
            findReportedEmployeeIds: async () => ['emp-1'],
            findOffDutyEmployeeIds: async () => ['emp-2'],
            findOnLeaveEmployeeIds: async () => [],
            hasEmployeeWorkedToday: async ({ employeeId }) => {
                // emp-3 không đi làm
                if (employeeId === 'personal-emp-3' || employeeId === 'emp-3') return false;
                // emp-4 và emp-5 có đi làm hôm nay
                if (employeeId === 'emp-4' || employeeId === 'personal-phuong') return true;
                return false;
            },
            createPenalty: async (p) => {
                penalties.push(p);
                return { id: 100 + penalties.length, ...p };
            }
        };

        const mockBot = {
            telegram: {
                sendMessage: async (chatId, text) => {
                    tgNotices.push({ chatId, text });
                }
            }
        };

        const scanDeadline = createScanTelesaleDeadline({
            telesaleRepository: mockRepo,
            bot: mockBot,
            now: () => new Date('2026-09-27T12:05:00Z') // 19:05 VN
        });

        await scanDeadline();

        // Chỉ có 2 người bị phạt: emp-4 (có đi làm) và emp-5 (đấu nối tài khoản cá nhân có đi làm)
        // emp-3 (không đi làm hôm nay) TUYỆT ĐỐI KHÔNG BỊ PHẠT!
        assert.equal(penalties.length, 2);
        assert.equal(penalties[0].employeeId, 'emp-4');
        assert.equal(penalties[1].employeeId, 'emp-5');

        // Tin thông báo phạt được gửi với thông tin chính xác
        assert.equal(tgNotices.length, 2);
        assert.match(tgNotices[0].text, /Phạm Thị Có Đi Làm/);
        assert.match(tgNotices[1].text, /Trịnh Khánh Phương/);
        // Kiểm tra mention nhân sự emp-5 sử dụng đúng linked_telegram_id cá nhân
        assert.match(tgNotices[1].text, /tg:\/\/user\?id=999888/);
    });

    test('sendTelesaleReminder chỉ nhắc những ai HÔM NAY ĐI LÀM mà chưa nộp, bỏ qua người nghỉ', async () => {
        let sentMessage = null;

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-5400720656', group_name: '00. BC TELESALE' }
            ],
            findMembersInTelesaleGroup: async () => [
                { id: 'emp-1', full_name: 'Nguyễn Văn Đã Nộp', telegram_id: '111' },
                { id: 'emp-2', full_name: 'Lê Văn Không Đi Làm', telegram_id: '222' },
                { id: 'emp-3', full_name: 'Lê Thị Quỳnh Chi', telegram_id: null, linked_employee_id: 'chi-personal', linked_telegram_id: '7968352478' }
            ],
            findReportedEmployeeIds: async () => ['emp-1'],
            hasEmployeeWorkedToday: async ({ employeeId }) => {
                // emp-2 không đi làm -> false
                if (employeeId === 'emp-2') return false;
                // emp-3 (Chi) hôm nay có đi làm -> true
                if (employeeId === 'chi-personal') return true;
                return false;
            }
        };

        const mockBot = {
            botInfo: { username: 'baocao_bot' },
            telegram: {
                sendMessage: async (chatId, text, opts) => {
                    sentMessage = { chatId, text, opts };
                }
            }
        };

        const sendReminder = createSendTelesaleReminder({
            telesaleRepository: mockRepo,
            bot: mockBot,
            now: () => new Date('2026-09-27T11:00:00Z') // 18:00 VN
        });

        const result = await sendReminder('-5400720656');

        assert.equal(result.success, true);
        assert.ok(sentMessage);
        assert.match(sentMessage.text, /NHẮC NỘP BÁO CÁO TELESALE HÀNG NGÀY/);
        // Trong danh sách nhắc: Phải có Lê Thị Quỳnh Chi (hôm nay có đi làm)
        assert.match(sentMessage.text, /Lê Thị Quỳnh Chi/);
        assert.match(sentMessage.text, /tg:\/\/user\?id=7968352478/);
        // KHÔNG ĐƯỢC nhắc Lê Văn Không Đi Làm (hôm nay không đi làm)
        assert.doesNotMatch(sentMessage.text, /Lê Văn Không Đi Làm/);
    });

    test('buildTelesaleReminderMessage định dạng chuẩn danh sách đi làm chưa nộp', () => {
        const text = buildTelesaleReminderMessage({
            groupName: '00. BC TELESALE',
            pendingStaff: [
                { full_name: 'Lê Thị Quỳnh Chi', linked_telegram_id: '7968352478' },
                { full_name: 'Nguyễn Hồng Việt', linked_telegram_id: '8813737154' }
            ]
        });

        assert.match(text, /00\. BC TELESALE/);
        assert.match(text, /Nhân sự đi làm hôm nay chưa nộp báo cáo:/);
        assert.match(text, /1\. <a href="tg:\/\/user\?id=7968352478">Lê Thị Quỳnh Chi<\/a>/);
        assert.match(text, /2\. <a href="tg:\/\/user\?id=8813737154">Nguyễn Hồng Việt<\/a>/);
        assert.match(text, /Nhân sự nghỉ ca OFF \/ có phép đã được tự động miễn nhắc/);
    });
});
