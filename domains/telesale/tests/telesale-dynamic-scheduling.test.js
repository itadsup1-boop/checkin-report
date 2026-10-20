import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createScanTelesaleDeadline } from '../application/scan-telesale-deadline.js';
import { createSummarizeDailyTelesale } from '../application/summarize-daily-telesale.js';
import { registerTelesaleCrons } from '../interfaces/cron/register-telesale-crons.js';

describe('Telesale Dynamic Scheduling & Custom Group Rules', () => {
    test('scanTelesaleDeadline áp dụng đúng mức phạt và giờ hạn chót tùy biến của nhóm', async () => {
        const penalties = [];
        const tgNotices = [];

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-100888', group_name: 'Nhóm VIP Telesale' }
            ],
            getFormConfig: async () => ({
                schedule_settings: {
                    penalty_enabled: true,
                    penalty_amount: 100000,
                    deadline_time: '20:00'
                }
            }),
            findMembersInTelesaleGroup: async () => [
                { id: 'emp-1', full_name: 'Trần Văn Vi Phạm', telegram_id: '999888' }
            ],
            findReportedEmployeeIds: async () => [],
            findOffDutyEmployeeIds: async () => [],
            findOnLeaveEmployeeIds: async () => [],
            createPenalty: async (p) => {
                penalties.push(p);
                return { id: 1, ...p };
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
            now: () => new Date('2026-09-29T13:05:00Z') // 20:05 VN
        });

        await scanDeadline('-100888');

        assert.equal(penalties.length, 1);
        assert.equal(penalties[0].amount, 100000);
        assert.match(penalties[0].reason, /sau 20:00/);

        assert.equal(tgNotices.length, 1);
        assert.match(tgNotices[0].text, /100\.000 đ/);
        assert.match(tgNotices[0].text, /20:00/);
    });

    test('scanTelesaleDeadline bỏ qua nhóm khi penalty_enabled = false', async () => {
        const penalties = [];
        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-100777', group_name: 'Nhóm Miễn Phạt' }
            ],
            getFormConfig: async () => ({
                schedule_settings: {
                    penalty_enabled: false
                }
            }),
            findMembersInTelesaleGroup: async () => [
                { id: 'emp-2', full_name: 'Nguyễn Văn B', telegram_id: '777' }
            ],
            findReportedEmployeeIds: async () => [],
            findOffDutyEmployeeIds: async () => [],
            findOnLeaveEmployeeIds: async () => [],
            createPenalty: async (p) => penalties.push(p)
        };

        const scanDeadline = createScanTelesaleDeadline({
            telesaleRepository: mockRepo,
            now: () => new Date('2026-09-29T12:05:00Z')
        });

        await scanDeadline('-100777');
        assert.equal(penalties.length, 0, 'Không được tạo phạt khi nhóm tắt tính năng');
    });

    test('summarizeDailyTelesale hiển thị các trường tùy biến trong summary_fields', async () => {
        let sentMessage = null;

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-100666', group_name: 'Nhóm Form Động' }
            ],
            getFormConfig: async () => ({
                fields: [
                    { key: 'so_lead', label: 'Số Lead Nhận', data_type: 'number', category: 'INPUT' },
                    { key: 'chot_deal', label: 'Số Deal Thành Công', data_type: 'number', category: 'INPUT' },
                    { key: 'doanh_so_deal', label: 'Doanh Số Bán Hàng', data_type: 'currency', category: 'INPUT' },
                    { key: 'ty_le_chot', label: 'Tỉ Lệ Chốt Deal', data_type: 'percentage', category: 'CALCULATED' }
                ],
                schedule_settings: {
                    summary_enabled: true,
                    summary_fields: ['so_lead', 'chot_deal', 'doanh_so_deal', 'ty_le_chot']
                }
            }),
            getDailyGroupSummary: async () => ({
                reports: [
                    { full_name: 'Thanh Hằng', so_nhan: 10, tong_lich: 2, tong_toi_hnay: 1, lich_ngay_mai: 0, tong_ds_hnay: 5000000, report_values: { so_lead: 15, chot_deal: 3, doanh_so_deal: 25000000, ty_le_chot: 20.0 } }
                ],
                totals: { so_nhan: 10, tong_ds: 5000000 },
                dynamicTotals: { so_lead: 15, chot_deal: 3, doanh_so_deal: 25000000, ty_le_chot: 20.0 }
            })
        };

        const sentMessages = [];
        const mockBot = {
            telegram: {
                sendMessage: async (chatId, text) => {
                    sentMessages.push(text);
                }
            }
        };

        const summarize = createSummarizeDailyTelesale({
            telesaleRepository: mockRepo,
            bot: mockBot,
            now: () => new Date('2026-09-29T12:00:00Z')
        });

        await summarize('-100666');

        assert.ok(sentMessages.length >= 1);
        const teamSummaryMsg = sentMessages[0];
        assert.match(teamSummaryMsg, /Số Lead Nhận: <b>15<\/b>/);
        assert.match(teamSummaryMsg, /Số Deal Thành Công: <b>3<\/b>/);
        assert.match(teamSummaryMsg, /Doanh Số Bán Hàng: <b>25\.000\.000 đ<\/b>/);
        assert.match(teamSummaryMsg, /Tỉ Lệ Chốt Deal: <b>20\.0%<\/b>/);
    });

    test('registerTelesaleCrons kích hoạt đúng tác vụ vào đúng phút cấu hình', async () => {
        const events = [];

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-100555', group_name: 'Nhóm Test Cron' }
            ],
            getFormConfig: async () => ({
                schedule_settings: {
                    remind_enabled: true,
                    remind_time: '17:45',
                    penalty_enabled: true,
                    deadline_time: '18:30',
                    penalty_amount: 80000,
                    summary_enabled: true,
                    summary_time: '18:30'
                }
            })
        };

        let scheduledCallback = null;
        const mockCron = {
            schedule: (cronExpr, cb) => {
                scheduledCallback = cb;
                return { stop: () => {} };
            }
        };

        registerTelesaleCrons({
            cron: mockCron,
            telesaleRepository: mockRepo,
            sendTelesaleReminder: async (gId) => events.push(`remind_${gId}`),
            scanTelesaleDeadline: async (gId, amount) => events.push(`penalty_${gId}_${amount}`),
            summarizeDailyTelesale: async (gId) => events.push(`summary_${gId}`),
            now: () => new Date('2026-09-29T10:45:00Z') // 17:45 VN
        });

        assert.ok(scheduledCallback, 'Cron schedule phải được gọi');

        // Chạy tick ở 17:45
        await scheduledCallback();
        assert.deepEqual(events, ['remind_-100555'], '17:45 phải kích hoạt nhắc nộp');
    });
});
