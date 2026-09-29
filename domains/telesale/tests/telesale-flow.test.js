import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createSubmitTelesaleReport } from '../application/submit-telesale-report.js';
import { createScanTelesaleDeadline } from '../application/scan-telesale-deadline.js';
import { createGetTelesaleBootstrap } from '../application/get-telesale-bootstrap.js';
import { createSummarizeDailyTelesale } from '../application/summarize-daily-telesale.js';
import { registerTelesaleTelegramHandler } from '../interfaces/telegram/register-telesale-handler.js';

describe('Telesale Application Flows', () => {
    test('submitTelesaleReport tính toán, lưu báo cáo và gửi thông báo', async () => {
        let savedReportData = null;
        let syncedSheetData = null;
        let sentTgMessage = null;

        const mockRepo = {
            findEmployeeByTelegramId: async (tgId) => ({
                id: 'emp-uuid-1',
                telegram_id: tgId,
                full_name: 'Nguyễn Văn A'
            }),
            getMonthlyPreviousRevenue: async () => 35000000,
            upsertDailyReport: async (data) => {
                savedReportData = data;
                return { id: 1, ...data };
            }
        };

        const mockSheetSync = {
            syncDailyReport: async (data) => {
                syncedSheetData = data;
                return 'https://docs.google.com/spreadsheets/d/1gQYXoylEysKKqUpYMxAzLw1nA7KC89eC-FO4kSzhlYU/edit';
            }
        };

        const mockBot = {
            telegram: {
                sendMessage: async (chatId, text, opts) => {
                    sentTgMessage = { chatId, text, opts };
                }
            }
        };

        const submitReport = createSubmitTelesaleReport({
            telesaleRepository: mockRepo,
            telesaleSheetSync: mockSheetSync,
            bot: mockBot,
            now: () => new Date('2026-09-22T10:00:00Z') // 17:00 VN
        });

        const result = await submitReport({
            telegramGroupId: '-100999888',
            telegramUserId: '123456',
            payload: {
                so_nhan: 25,
                so_trung_knc_vang: 5,
                lich_pv_moi: 5,
                lich_pv_cu: 2,
                lich_ngay_mai: 4,
                tong_toi_hnay: 5,
                tong_bong_hnay: 1,
                tong_ds_hnay: 15000000
            }
        });

        assert.equal(result.success, true);
        assert.equal(savedReportData.employeeName, 'Nguyễn Văn A');
        assert.equal(savedReportData.tongLich, 7);
        assert.equal(savedReportData.tongDsThang, 50000000); // 35tr + 15tr
        assert.equal(savedReportData.tyLeKhachToiDs, 3000000); // 15tr / 5 khách
        assert.equal(savedReportData.tyLeLich, 28.0); // 7/25 = 28%
        assert.equal(savedReportData.tyLeToi, 20.0); // 5/25 = 20%

        assert.ok(syncedSheetData, 'Google Sheet phải được đồng bộ');
        assert.equal(syncedSheetData.employeeName, 'Nguyễn Văn A');

        assert.ok(sentTgMessage, 'Telegram bot phải gửi tin');
        assert.match(sentTgMessage.text, /BÁO CÁO TELE HÀNG NGÀY/);
        assert.match(sentTgMessage.text, /Tổng lịch cộng dồn: <b>7 lịch<\/b>/);
        assert.match(sentTgMessage.text, /Tổng DS cộng dồn tháng: <b>50\.000\.000 đ<\/b>/);
        assert.match(sentTgMessage.text, /Tỉ lệ tới cộng dồn: <b>20%<\/b> 🌟/);
    });

    test('scanTelesaleDeadline bỏ qua nhân sự nghỉ OFF và phạt 50k người vi phạm sau 19h', async () => {
        const penalties = [];
        const tgNotices = [];

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-100999', group_name: 'Team Telesale' }
            ],
            findMembersInTelesaleGroup: async () => [
                { id: 'emp-1', full_name: 'Lan Anh (Đã nộp)', telegram_id: '111' },
                { id: 'emp-2', full_name: 'Bảo Ngọc (Nghỉ ca OFF)', telegram_id: '222' },
                { id: 'emp-3', full_name: 'Quang Minh (Có phép)', telegram_id: '333' },
                { id: 'emp-4', full_name: 'Hoàng Nam (Vi phạm)', telegram_id: '444' }
            ],
            findReportedEmployeeIds: async () => ['emp-1'], // emp-1 đã nộp
            findOffDutyEmployeeIds: async () => ['emp-2'], // emp-2 có ca OFF
            findOnLeaveEmployeeIds: async () => ['emp-3'], // emp-3 có đơn nghỉ phép
            createPenalty: async (p) => {
                penalties.push(p);
                return { id: 101, ...p };
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
            now: () => new Date('2026-09-22T12:05:00Z') // 19:05 VN
        });

        await scanDeadline();

        // Chỉ có emp-4 bị phạt
        assert.equal(penalties.length, 1);
        assert.equal(penalties[0].employeeId, 'emp-4');
        assert.equal(penalties[0].amount, 50000);

        // Thông báo phạt gửi lên Telegram
        assert.equal(tgNotices.length, 1);
        assert.match(tgNotices[0].text, /QUÁ HẠN BÁO CÁO TELESALE/);
        assert.match(tgNotices[0].text, /Hoàng Nam/);
        assert.match(tgNotices[0].text, /50\.000 đ/);
    });

    test('getTelesaleBootstrap trả về thông tin nhân viên và báo cáo hôm nay nếu đã nộp', async () => {
        const mockRepo = {
            findEmployeeByTelegramId: async (tgId) => ({
                id: 'emp-1',
                telegram_id: tgId,
                full_name: 'Lê Thuỳ Trang'
            }),
            getDailyReport: async () => ({
                so_nhan: 15,
                tong_ds_hnay: 6000000
            }),
            getMonthlyPreviousRevenue: async () => 20000000
        };

        const getBootstrap = createGetTelesaleBootstrap({
            telesaleRepository: mockRepo,
            now: () => new Date('2026-09-22T10:00:00Z')
        });

        const data = await getBootstrap({
            telegramGroupId: '-100999',
            telegramUserId: '999888'
        });

        assert.equal(data.isRegistered, true);
        assert.equal(data.employee.full_name, 'Lê Thuỳ Trang');
        assert.equal(data.existingReport.so_nhan, 15);
        assert.equal(data.existingReport.tong_ds_hnay, 6000000);
        assert.equal(data.monthlyPrevRevenue, 20000000);
    });

    test('summarizeDailyTelesale gửi tin tổng kết và gửi thêm tin cảnh báo khi có nhân sự vi phạm ngưỡng', async () => {
        const sentMessages = [];

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-100999', group_name: 'Team Telesale', customer_sheet_id: 'sheet-123' }
            ],
            getDailyGroupSummary: async () => ({
                reports: [
                    { full_name: 'Trịnh Khánh Phương', so_nhan: 4, tong_lich: 1, tong_toi_hnay: 1, lich_ngay_mai: 2, tong_ds_hnay: 11000000 },
                    { full_name: 'trang tele', so_nhan: 12, tong_lich: 0, tong_toi_hnay: 0, lich_ngay_mai: 1, tong_ds_hnay: 7000000 },
                    { full_name: 'Quỳnh', so_nhan: 3, tong_lich: 1, tong_toi_hnay: 1, lich_ngay_mai: 1, tong_ds_hnay: 4000000 },
                    { full_name: 'Nguyễn Hồng Việt', so_nhan: 5, tong_lich: 0, tong_toi_hnay: 0, lich_ngay_mai: 0, tong_ds_hnay: 0 },
                    { full_name: 'Lê Thị Quỳnh Chi', so_nhan: 5, tong_lich: 2, tong_toi_hnay: 2, lich_ngay_mai: 2, tong_ds_hnay: 0 },
                    { full_name: 'Boss Hỗ Trợ', so_nhan: 0, tong_lich: 0, tong_toi_hnay: 0, lich_ngay_mai: 0, tong_ds_hnay: 0 },
                    { full_name: 'trang', so_nhan: 7, tong_lich: 0, tong_toi_hnay: 0, lich_ngay_mai: 0, tong_ds_hnay: 0 }
                ],
                totals: {
                    so_nhan: 36,
                    tong_vang: 5,
                    tong_lich: 4,
                    tong_toi: 4,
                    tong_bong: 1,
                    lich_ngay_mai: 6,
                    tong_ds: 22000000
                }
            })
        };

        const mockBot = {
            telegram: {
                sendMessage: async (chatId, text, opts) => {
                    sentMessages.push({ chatId, text, opts });
                }
            }
        };

        const summarize = createSummarizeDailyTelesale({
            telesaleRepository: mockRepo,
            bot: mockBot,
            now: () => new Date('2026-09-23T12:00:00Z') // 19:00 VN ngày 23/09/2026
        });

        await summarize();

        // Phải gửi chính xác 2 tin nhắn: 1 tin tổng kết toàn đội + 1 tin thống kê cảnh báo
        assert.equal(sentMessages.length, 2);

        // Tin 1: Tổng kết toàn đội
        assert.match(sentMessages[0].text, /TỔNG KẾT TELESALE TOÀN ĐỘI NGÀY 23\/09\/2026/);
        assert.match(sentMessages[0].text, /Tổng số nhận: <b>36<\/b>/);
        assert.match(sentMessages[0].text, /Tổng khách văng\/knc: <b>5<\/b>/);
        assert.match(sentMessages[0].text, /Tổng lịch hẹn ngày mai: <b>6<\/b>/);
        assert.match(sentMessages[0].text, /TỔNG DOANH SỐ: 22\.000\.000 đ/);
        assert.match(sentMessages[0].text, /<b>trang tele<\/b>: 12 số \| 0 lịch \| 0 tới \| 1 lịch mai \| 7\.000\.000 đ/);

        // Tin 2: Thống kê hiệu suất (Khen thưởng > 19% và Cảnh báo < 25%, < 15%)
        assert.match(sentMessages[1].text, /THỐNG KÊ HIỆU SUẤT TELESALE/);
        assert.match(sentMessages[1].text, /KHEN THƯỞNG TỶ LỆ TỚI \(&gt; 19%\):/);
        assert.match(sentMessages[1].text, /<b>Lê Thị Quỳnh Chi<\/b>: 2\/5 số \(<b>40%<\/b> 🌟\)/);
        assert.match(sentMessages[1].text, /<b>Trịnh Khánh Phương<\/b>: 1\/4 số \(<b>25%<\/b> 🌟\)/);
        assert.match(sentMessages[1].text, /<b>Quỳnh<\/b>: 1\/3 số \(<b>33\.3%<\/b> 🌟\)/);

        assert.match(sentMessages[1].text, /CẢNH BÁO TỶ LỆ LỊCH \(&lt; 25%\):/);
        assert.match(sentMessages[1].text, /<b>trang tele<\/b>: 0\/12 số \(<b>0%<\/b>\)/);
        assert.match(sentMessages[1].text, /<b>Nguyễn Hồng Việt<\/b>: 0\/5 số \(<b>0%<\/b>\)/);
        assert.match(sentMessages[1].text, /<b>trang<\/b>: 0\/7 số \(<b>0%<\/b>\)/);

        assert.match(sentMessages[1].text, /CẢNH BÁO TỶ LỆ TỚI \(&lt; 15%\):/);

        // Boss Hỗ Trợ (0 số nhận) không nằm trong bất kỳ danh sách nào
        assert.doesNotMatch(sentMessages[1].text, /Boss Hỗ Trợ/);
    });

    test('summarizeDailyTelesale không gửi tin hiệu suất thứ 2 nếu không có ai đạt thưởng hay cảnh báo', async () => {
        const sentMessages = [];

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-100999', group_name: 'Team Telesale', customer_sheet_id: 'sheet-123' }
            ],
            getDailyGroupSummary: async () => ({
                reports: [
                    // 6/20 = 30% (>= 25% chuẩn), 3/20 = 15% (>= 15% và <= 19% mức chuẩn không thưởng không phạt)
                    { full_name: 'Trịnh Khánh Phương', so_nhan: 20, tong_lich: 6, tong_toi_hnay: 3, lich_ngay_mai: 2, tong_ds_hnay: 11000000 },
                    { full_name: 'Quỳnh', so_nhan: 20, tong_lich: 6, tong_toi_hnay: 3, lich_ngay_mai: 2, tong_ds_hnay: 4000000 }
                ],
                totals: {
                    so_nhan: 40,
                    tong_lich: 12,
                    tong_toi: 6,
                    tong_bong: 0,
                    lich_ngay_mai: 4,
                    tong_ds: 15000000
                }
            })
        };

        const mockBot = {
            telegram: {
                sendMessage: async (chatId, text, opts) => {
                    sentMessages.push({ chatId, text, opts });
                }
            }
        };

        const summarize = createSummarizeDailyTelesale({
            telesaleRepository: mockRepo,
            bot: mockBot,
            now: () => new Date('2026-09-23T12:00:00Z')
        });

        await summarize();

        // Chỉ gửi đúng 1 tin tổng kết, KHÔNG gửi tin cảnh báo
        assert.equal(sentMessages.length, 1);
        assert.match(sentMessages[0].text, /TỔNG KẾT TELESALE TOÀN ĐỘI/);
    });

    test('submitTelesaleReport đồng bộ đúng vào tên đầy đủ khi người dùng chỉ ghi tên gọi rút gọn', async () => {
        let savedReport = null;

        const mockRepo = {
            findOrCreateEmployee: async ({ fullName, telegramGroupId }) => {
                if (fullName === 'Phương' && telegramGroupId === '-100999') {
                    return {
                        id: 'emp-phuong-123',
                        full_name: 'Trịnh Khánh Phương',
                        role: 'Telesale'
                    };
                }
                return null;
            },
            getMonthlyPreviousRevenue: async () => 10000000,
            upsertDailyReport: async (data) => {
                savedReport = data;
                return { id: 99, ...data };
            }
        };

        const mockSheetSync = {
            syncDailyReport: async () => 'https://mock.sheet/url'
        };

        const mockBot = {
            telegram: {
                sendMessage: async () => {}
            }
        };

        const submit = createSubmitTelesaleReport({
            telesaleRepository: mockRepo,
            telesaleSheetSync: mockSheetSync,
            bot: mockBot,
            now: () => new Date('2026-09-26T10:00:00Z')
        });

        await submit({
            telegramGroupId: '-100999',
            telegramUserId: '7812616093',
            payload: {
                employee_name: 'Phương',
                so_nhan: 5
            }
        });

        assert.ok(savedReport);
        assert.equal(savedReport.employeeId, 'emp-phuong-123');
        assert.equal(savedReport.employeeName, 'Trịnh Khánh Phương');
    });

    test('registerTelesaleTelegramHandler hiển thị nút bấm hỏi khi tên gần giống và ghi nhận khi bấm chọn', async () => {
        let textHandler = null;
        let actionHandler = null;
        let regexAction = null;
        let botReplies = [];
        let botEdits = [];
        let submittedData = null;

        const mockBot = {
            command: () => {},
            on: (event, handler) => {
                if (event === 'text') textHandler = handler;
            },
            action: (regex, handler) => {
                regexAction = regex;
                actionHandler = handler;
            }
        };

        const mockRepo = {
            findMembersInTelesaleGroup: async (groupId) => [
                { id: 'uuid-tkp', full_name: 'Trịnh Khánh Phương' },
                { id: 'uuid-nhv', full_name: 'Nguyễn Hồng Việt' }
            ]
        };

        registerTelesaleTelegramHandler({
            bot: mockBot,
            telesaleRepository: mockRepo,
            submitTelesaleReport: async (data) => {
                submittedData = data;
            },
            getGroupRole: async () => 'telesale'
        });

        assert.ok(textHandler, 'Phải đăng ký text handler');
        assert.ok(actionHandler, 'Phải đăng ký action handler');

        // 1. Gửi tin nhắn với tên rút gọn "Phương"
        const reportText = `Nhân sự:  Phương \n` +
            `Số nhận: 5 \n` +
            `Số trùng / KNC/ Văng:  3\n` +
            `Số lịch PV mới: 0 \n` +
            `Số lịch PV cũ:  0\n` +
            `Lịch hẹn ngày mai: 0\n` +
            `Tổng tới hôm nay:  0\n` +
            `Tổng bong hôm nay: 0\n` +
            `TỔNG DS hnay: 0`;

        const mockCtx = {
            message: {
                message_id: 1234,
                text: reportText
            },
            chat: {
                id: -5400720656,
                type: 'supergroup'
            },
            from: {
                id: 9999,
                first_name: 'User'
            },
            reply: async (text, opts) => {
                botReplies.push({ text, opts });
            }
        };

        await textHandler(mockCtx, () => {});

        // Chưa submit ngay vì cần xác nhận
        assert.equal(submittedData, null);
        assert.equal(botReplies.length, 1);
        assert.match(botReplies[0].text, /XÁC NHẬN NHÂN SỰ NỘP BÁO CÁO/);
        assert.match(botReplies[0].text, /Phương/);

        // Kiểm tra bàn phím inline có nút bấm ứng viên "Trịnh Khánh Phương"
        const keyboard = botReplies[0].opts?.reply_markup?.inline_keyboard;
        assert.ok(keyboard);
        assert.equal(keyboard[0][0].text, '👤 Trịnh Khánh Phương');

        const callbackData = keyboard[0][0].callback_data;
        assert.match(callbackData, /^tele_cf:/);

        // 2. Người dùng bấm vào nút chọn Trịnh Khánh Phương
        const match = callbackData.match(regexAction);
        assert.ok(match);

        const mockActionCtx = {
            match,
            from: { id: 9999 },
            answerCbQuery: async () => {},
            editMessageText: async (text) => {
                botEdits.push(text);
            }
        };

        await actionHandler(mockActionCtx);

        // Báo cáo đã được ghi nhận đúng cho Trịnh Khánh Phương!
        assert.ok(submittedData);
        assert.equal(submittedData.employeeId, 'uuid-tkp');
        assert.equal(submittedData.payload.employee_name, 'Trịnh Khánh Phương');
        assert.equal(botEdits.length, 1);
        assert.match(botEdits[0], /ĐÃ XÁC NHẬN BÁO CÁO/);
    });
});


