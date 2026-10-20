import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    DEFAULT_TELESALE_FIELDS,
    DEFAULT_ADS_FIELDS,
    DEFAULT_FEATURES,
    DEFAULT_MULTI_SLOTS,
    DEFAULT_SCHEDULE_SETTINGS
} from '../domain/safe-formula-engine.js';
import { createTelesaleRepository } from '../infrastructure/postgres/telesale-repository.js';

describe('Telesale Multi-Slot & Dimensions (Step 1 Verification)', () => {
    it('DEFAULT_ADS_FIELDS chứa đầy đủ 9 trường mẫu báo cáo Ads theo giờ', () => {
        assert.strictEqual(DEFAULT_ADS_FIELDS.length, 9);
        const keys = DEFAULT_ADS_FIELDS.map(f => f.key);
        assert.ok(keys.includes('noi_dung'), 'Cần có trường noi_dung');
        assert.ok(keys.includes('tong_chi_tieu'), 'Cần có trường tong_chi_tieu');
        assert.ok(keys.includes('tong_mess'), 'Cần có trường tong_mess');
        assert.ok(keys.includes('tong_so'), 'Cần có trường tong_so');
        assert.ok(keys.includes('tong_ds'), 'Cần có trường tong_ds');
        assert.ok(keys.includes('tong_ds_cong_don'), 'Cần có trường tong_ds_cong_don');
        assert.ok(keys.includes('tong_chi_tieu_cong_don'), 'Cần có trường tong_chi_tieu_cong_don');
        assert.ok(keys.includes('ty_le_ads_cong_don'), 'Cần có trường ty_le_ads_cong_don');
        assert.ok(keys.includes('ghi_chu'), 'Cần có trường ghi_chu');

        const adsRate = DEFAULT_ADS_FIELDS.find(f => f.key === 'ty_le_ads_cong_don');
        assert.strictEqual(adsRate.type, 'percentage');
        assert.strictEqual(adsRate.category, 'CALCULATED');
    });

    it('DEFAULT_FEATURES và DEFAULT_MULTI_SLOTS có cấu hình chuẩn xác', () => {
        assert.strictEqual(DEFAULT_FEATURES.schedule_mode, 'SINGLE_SLOT');
        assert.strictEqual(DEFAULT_FEATURES.has_projects, false);
        assert.strictEqual(DEFAULT_FEATURES.has_services, false);
        assert.strictEqual(DEFAULT_FEATURES.summary_template, 'BY_EMPLOYEE');

        assert.strictEqual(DEFAULT_MULTI_SLOTS.length, 3);
        const slotIds = DEFAULT_MULTI_SLOTS.map(s => s.id);
        assert.deepStrictEqual(slotIds, ['09h', '12h', '18h']);
    });

    it('getDailyGroupSummary hỗ trợ gom nhóm theo service_name và project_name', async () => {
        const mockRows = [
            {
                id: 1,
                telegram_group_id: '-1001',
                employee_id: 10,
                full_name: 'Nguyễn Văn Ads',
                report_date: '2026-10-17',
                report_slot: '09h',
                project_name: 'Dự án Alpha',
                service_name: 'Dịch vụ Nâng ngực',
                tong_ds_hnay: 10000000,
                report_values: {
                    tong_chi_tieu: 2000000,
                    tong_mess: 35,
                    tong_so: 12,
                    tong_ds: 10000000
                }
            },
            {
                id: 2,
                telegram_group_id: '-1001',
                employee_id: 10,
                full_name: 'Nguyễn Văn Ads',
                report_date: '2026-10-17',
                report_slot: '09h',
                project_name: 'Dự án Beta',
                service_name: 'Dịch vụ Hút mỡ',
                tong_ds_hnay: 15000000,
                report_values: {
                    tong_chi_tieu: 3000000,
                    tong_mess: 40,
                    tong_so: 18,
                    tong_ds: 15000000
                }
            },
            {
                id: 3,
                telegram_group_id: '-1001',
                employee_id: 11,
                full_name: 'Trần Thị Ads',
                report_date: '2026-10-17',
                report_slot: '09h',
                project_name: 'Dự án Alpha',
                service_name: 'Dịch vụ Nâng ngực',
                tong_ds_hnay: 5000000,
                report_values: {
                    tong_chi_tieu: 1000000,
                    tong_mess: 15,
                    tong_so: 5,
                    tong_ds: 5000000
                }
            }
        ];

        const mockPool = {
            query: async (sql, params) => {
                return { rows: mockRows };
            }
        };

        const repo = createTelesaleRepository({ pool: mockPool });
        const summary = await repo.getDailyGroupSummary('-1001', '2026-10-17', '09h');

        assert.strictEqual(summary.reports.length, 3);
        assert.ok(summary.byService['Dịch vụ Nâng ngực'], 'Có gom nhóm Dịch vụ Nâng ngực');
        assert.ok(summary.byService['Dịch vụ Hút mỡ'], 'Có gom nhóm Dịch vụ Hút mỡ');

        // Dịch vụ Nâng ngực tổng DS = 10tr + 5tr = 15tr
        assert.strictEqual(summary.byService['Dịch vụ Nâng ngực'].totals.tong_ds, 15000000);
        assert.strictEqual(summary.byService['Dịch vụ Nâng ngực'].totals.tong_chi_tieu, 3000000);
        assert.strictEqual(summary.byService['Dịch vụ Nâng ngực'].totals.tong_mess, 50);

        // Dịch vụ Hút mỡ tổng DS = 15tr, chi tiêu = 3tr
        assert.strictEqual(summary.byService['Dịch vụ Hút mỡ'].totals.tong_ds, 15000000);
        assert.strictEqual(summary.byService['Dịch vụ Hút mỡ'].totals.tong_chi_tieu, 3000000);

        // Gom nhóm theo Dự án
        assert.ok(summary.byProject['Dự án Alpha']);
        assert.ok(summary.byProject['Dự án Beta']);
        assert.strictEqual(summary.byProject['Dự án Alpha'].reports.length, 2);
    });

    it('saveFormConfig và getFormConfig xử lý đúng features, projects, services', async () => {
        let insertedValues = null;
        const mockPool = {
            query: async (sql, params) => {
                if (sql.includes('INSERT INTO telesale_form_configs')) {
                    insertedValues = params;
                    return {
                        rows: [{
                            telegram_group_id: params[0],
                            group_name: params[1],
                            fields: JSON.parse(params[2] || '[]'),
                            schedule_settings: JSON.parse(params[3] || '{}'),
                            sheet_settings: JSON.parse(params[4] || '{}'),
                            features: JSON.parse(params[5] || '{}'),
                            projects: JSON.parse(params[6] || '[]'),
                            services: JSON.parse(params[7] || '[]')
                        }]
                    };
                }
                return { rows: [] };
            }
        };

        const repo = createTelesaleRepository({ pool: mockPool });
        const saved = await repo.saveFormConfig({
            telegramGroupId: '-5492969929',
            groupName: '222. Báo cáo Ads Đức',
            fields: DEFAULT_ADS_FIELDS,
            scheduleSettings: DEFAULT_SCHEDULE_SETTINGS,
            features: {
                has_projects: true,
                has_services: true,
                schedule_mode: 'MULTI_SLOT',
                summary_template: 'BY_SERVICE'
            },
            projects: ['Dự án Thẩm Mỹ Sài Gòn', 'Dự án Nha Khoa'],
            services: ['Nâng ngực', 'Hút mỡ', 'Nâng mũi']
        });

        assert.strictEqual(saved.telegram_group_id, '-5492969929');
        assert.strictEqual(saved.features.has_projects, true);
        assert.strictEqual(saved.features.has_services, true);
        assert.strictEqual(saved.features.schedule_mode, 'MULTI_SLOT');
        assert.strictEqual(saved.features.summary_template, 'BY_SERVICE');
        assert.deepStrictEqual(saved.projects, ['Dự án Thẩm Mỹ Sài Gòn', 'Dự án Nha Khoa']);
        assert.deepStrictEqual(saved.services, ['Nâng ngực', 'Hút mỡ', 'Nâng mũi']);
    });
});

describe('Telesale Multi-Slot & Dimensions (Step 3 Verification)', () => {
    it('calculateDynamicForm tính chính xác cộng dồn mốc giờ (hourlyPrevious) và tỷ lệ % Ads cộng dồn', async () => {
        const { calculateDynamicForm } = await import('../domain/safe-formula-engine.js');

        // Mốc 1 (09h): Chưa có lũy kế giờ trước đó
        const raw09h = {
            noi_dung: 'Chạy chiến dịch mở màn',
            tong_chi_tieu: 500000,
            tong_mess: 20,
            tong_so: 6,
            tong_ds: 2000000
        };
        const res09h = calculateDynamicForm(DEFAULT_ADS_FIELDS, raw09h, {}, {});
        assert.strictEqual(res09h.values.tong_chi_tieu, 500000);
        assert.strictEqual(res09h.values.tong_ds, 2000000);
        assert.strictEqual(res09h.values.tong_chi_tieu_cong_don, 500000);
        assert.strictEqual(res09h.values.tong_ds_cong_don, 2000000);
        assert.strictEqual(res09h.values.ty_le_ads_cong_don, 25); // (500k / 2000k) * 100 = 25%

        // Mốc 2 (12h): hourlyPrevious kế thừa từ 09h (chi tiêu 500k, DS 2000k)
        const raw12h = {
            noi_dung: 'Duy trì ngân sách trưa',
            tong_chi_tieu: 300000,
            tong_mess: 15,
            tong_so: 4,
            tong_ds: 1000000
        };
        const hourlyPrev12h = {
            tong_chi_tieu: 500000,
            tong_ds: 2000000
        };
        const res12h = calculateDynamicForm(DEFAULT_ADS_FIELDS, raw12h, {}, hourlyPrev12h);
        assert.strictEqual(res12h.values.tong_chi_tieu, 300000);
        assert.strictEqual(res12h.values.tong_ds, 1000000);
        assert.strictEqual(res12h.values.tong_chi_tieu_cong_don, 800000); // 300k + 500k = 800k
        assert.strictEqual(res12h.values.tong_ds_cong_don, 3000000); // 1tr + 2tr = 3tr
        assert.strictEqual(res12h.values.ty_le_ads_cong_don, 26.67); // (800k / 3000k) * 100 = 26.67%

        // Mốc 3 (18h): hourlyPrevious là tổng từ 09h + 12h (chi tiêu 800k, DS 3000k)
        const raw18h = {
            noi_dung: 'Tối ưu buổi tối',
            tong_chi_tieu: 200000,
            tong_mess: 10,
            tong_so: 3,
            tong_ds: 1000000
        };
        const hourlyPrev18h = {
            tong_chi_tieu: 800000,
            tong_ds: 3000000
        };
        const res18h = calculateDynamicForm(DEFAULT_ADS_FIELDS, raw18h, {}, hourlyPrev18h);
        assert.strictEqual(res18h.values.tong_chi_tieu_cong_don, 1000000); // 200k + 800k = 1tr
        assert.strictEqual(res18h.values.tong_ds_cong_don, 4000000); // 1tr + 3tr = 4tr
        assert.strictEqual(res18h.values.ty_le_ads_cong_don, 25); // (1tr / 4tr) * 100 = 25%
    });

    it('buildDynamicTelesaleReportMessage format chuẩn xác mẫu Báo cáo Ads theo giờ của người dùng', async () => {
        const { calculateDynamicForm } = await import('../domain/safe-formula-engine.js');
        const { buildDynamicTelesaleReportMessage } = await import('../domain/telesale-messages.js');

        const raw = {
            noi_dung: 'Chiến dịch test FB chạy ổn định',
            tong_chi_tieu: 600000,
            tong_mess: 30,
            tong_so: 10,
            tong_ds: 2500000,
            ghi_chu: 'Cần tăng thêm ngân sách chiều'
        };
        const dynamicResult = calculateDynamicForm(DEFAULT_ADS_FIELDS, raw, {}, { tong_chi_tieu: 400000, tong_ds: 1500000 });

        const msg = buildDynamicTelesaleReportMessage({
            employeeName: 'Nguyễn Văn Ads',
            dateStr: '17/10/2026',
            fields: DEFAULT_ADS_FIELDS,
            dynamicResult,
            reportSlot: '12h',
            projectName: 'Dự án Thẩm Mỹ Sài Gòn',
            serviceName: 'Dịch vụ Hút mỡ'
        });

        assert.ok(msg.includes('📊 <b>BÁO CÁO ADS THEO GIỜ</b>'), 'Phải có tiêu đề Báo cáo Ads theo giờ');
        assert.ok(msg.includes('⏰ Giờ báo cáo: <b>12h</b> - bot tự động'), 'Phải có mốc giờ báo cáo');
        assert.ok(msg.includes('👤 Nhân viên Ads: <b>Nguyễn Văn Ads</b>'), 'Phải có họ tên nhân viên Ads');
        assert.ok(msg.includes('<b>NHÂN VIÊN ADS NHẬP</b>'), 'Phải có phần phân cách Nhân viên Ads nhập');
        assert.ok(msg.includes('DỰ ÁN: <b>Dự án Thẩm Mỹ Sài Gòn</b>'), 'Phải hiển thị Dự án');
        assert.ok(msg.includes('DỊCH VỤ: <b>Dịch vụ Hút mỡ</b>'), 'Phải hiển thị Dịch vụ');
        assert.ok(msg.includes('Tổng chi tiêu: <b>600.000 đ</b>'), 'Phải hiển thị Tổng chi tiêu');
        assert.ok(msg.includes('Tổng Mess: <b>30 tin nhắn</b>'), 'Phải hiển thị Tổng Mess');
        assert.ok(msg.includes('Tổng số (SĐT): <b>10 SĐT khách hàng</b>'), 'Phải hiển thị Tổng số khách hàng');
        assert.ok(msg.includes('Tổng DS cộng dồn: <b>4.000.000 đ</b> -  BOT TỰ ĐỘNG'), 'Phải có Tổng DS cộng dồn - BOT TỰ ĐỘNG');
        assert.ok(msg.includes('Tổng chi tiêu cộng dồn: <b>1.000.000 đ</b> -  BOT TỰ ĐỘNG'), 'Phải có Tổng chi tiêu cộng dồn - BOT TỰ ĐỘNG');
        assert.ok(msg.includes('% Ads cộng dồn: <b>25%</b>'), 'Phải có % Ads cộng dồn');
        assert.ok(msg.includes('📝 <b>Ghi chú / Vấn đề cần xử lý:</b> <i>Cần tăng thêm ngân sách chiều</i>'), 'Phải hiển thị Ghi chú');
    });

    it('buildTelesaleDailyTeamSummary format chuẩn mẫu tổng hợp BY_SERVICE gom theo Dịch vụ', async () => {
        const { buildTelesaleDailyTeamSummary } = await import('../domain/telesale-messages.js');

        const byService = {
            'Nâng ngực': {
                service_name: 'Nâng ngực',
                reports: [
                    { full_name: 'Nhân sự 1', report_values: { ghi_chu: 'Cần duyệt thêm content mới' } }
                ],
                totals: {
                    tong_chi_tieu: 3000000,
                    tong_mess: 60,
                    tong_so: 20,
                    tong_ds: 15000000,
                    tong_chi_tieu_cong_don: 3000000,
                    tong_ds_cong_don: 15000000
                }
            },
            'Hút mỡ': {
                service_name: 'Hút mỡ',
                reports: [],
                totals: {
                    tong_chi_tieu: 2000000,
                    tong_mess: 40,
                    tong_so: 15,
                    tong_ds: 10000000,
                    tong_chi_tieu_cong_don: 2000000,
                    tong_ds_cong_don: 10000000
                }
            }
        };

        const dynamicTotals = {
            tong_chi_tieu: 5000000,
            tong_mess: 100,
            tong_so: 35,
            tong_ds: 25000000,
            tong_chi_tieu_cong_don: 5000000,
            tong_ds_cong_don: 25000000
        };

        const summaryMsg = buildTelesaleDailyTeamSummary({
            dateStr: '17/10/2026',
            teamTotals: { tong_ds: 25000000 },
            summaryTemplate: 'BY_SERVICE',
            byService,
            dynamicTotals,
            reportSlot: '18h'
        });

        assert.ok(summaryMsg.includes('🤖 <b>(BOT TỔNG HỢP BÁO CÁO )</b>'), 'Tiêu đề BOT Tổng hợp');
        assert.ok(summaryMsg.includes('📊 <b>TỔNG HỢP BC CỘNG DỒN TẤT CẢ DỰ ÁN</b>'), 'Tiêu đề Tổng hợp BC cộng dồn tất cả dự án');
        assert.ok(summaryMsg.includes('THEO DỊCH VỤ'), 'Có tiêu đề gom THEO DỊCH VỤ');
        assert.ok(summaryMsg.includes('🏷 <b>Dịch vụ: Nâng ngực</b>'), 'Hiển thị Dịch vụ Nâng ngực');
        assert.ok(summaryMsg.includes('• Tổng chi tiêu: <b>3.000.000 đ</b>'), 'Tổng chi tiêu DV Nâng ngực');
        assert.ok(summaryMsg.includes('• % Ads cộng dồn: <b>20%</b>'), 'Tỷ lệ % Ads DV Nâng ngực');
        assert.ok(summaryMsg.includes('🏷 <b>Dịch vụ: Hút mỡ</b>'), 'Hiển thị Dịch vụ Hút mỡ');
        assert.ok(summaryMsg.includes('🏆 <b>TỔNG HỢP TẤT CẢ DỊCH VỤ:</b>'), 'Phải có tổng hợp toàn bộ dịch vụ');
        assert.ok(summaryMsg.includes('• Tổng chi tiêu: <b>5.000.000 đ</b>'), 'Tổng chi tiêu toàn đội');
        assert.ok(summaryMsg.includes('• % Ads cộng dồn: <b>20%</b>'), 'Tỷ lệ % Ads toàn đội');
        assert.ok(summaryMsg.includes('📝 <b>Ghi chú / Vấn đề cần xử lý:</b>'), 'Hiển thị ghi chú gom nhóm');
        assert.ok(summaryMsg.includes('Cần duyệt thêm content mới'), 'Nội dung ghi chú');
    });

    it('Đảm bảo 100% tương thích ngược với nhóm Telesale truyền thống (SINGLE_SLOT, BY_EMPLOYEE)', async () => {
        const { buildDynamicTelesaleReportMessage, buildTelesaleDailyTeamSummary } = await import('../domain/telesale-messages.js');
        const { calculateDynamicForm, DEFAULT_TELESALE_FIELDS } = await import('../domain/safe-formula-engine.js');

        // Báo cáo cá nhân Telesale truyền thống
        const rawTele = {
            so_nhan: 20,
            so_trung_knc_vang: 2,
            lich_pv_moi: 5,
            lich_pv_cu: 1,
            lich_ngay_mai: 3,
            tong_toi_hnay: 4,
            tong_bong_hnay: 1,
            tong_ds_hnay: 15000000
        };
        const dynamicResult = calculateDynamicForm(DEFAULT_TELESALE_FIELDS, rawTele, { tong_ds_thang: 50000000 });
        const teleMsg = buildDynamicTelesaleReportMessage({
            employeeName: 'Nguyễn Văn Telesale',
            dateStr: '17/10/2026',
            fields: DEFAULT_TELESALE_FIELDS,
            dynamicResult
        });

        assert.ok(teleMsg.includes('📊 <b>BÁO CÁO TELE HÀNG NGÀY</b>'), 'Phải giữ nguyên tiêu đề Báo cáo Tele hàng ngày');
        assert.ok(teleMsg.includes('Nhân sự: <b>Nguyễn Văn Telesale</b>'), 'Phải giữ nguyên format Nhân sự:');
        assert.ok(teleMsg.includes('🤖 BOT tự tính toán:'), 'Phải giữ nguyên BOT tự tính toán');
        assert.ok(!teleMsg.includes('BÁO CÁO ADS THEO GIỜ'), 'Không được nhầm sang mẫu Ads');

        // Tổng kết đội Telesale truyền thống
        const teleSummary = buildTelesaleDailyTeamSummary({
            dateStr: '17/10/2026',
            teamTotals: {
                so_nhan: 40,
                so_trung_knc_vang: 5,
                tong_lich: 12,
                tong_toi: 8,
                tong_bong: 2,
                lich_ngay_mai: 6,
                tong_ds: 35000000
            },
            memberSummaries: [
                { name: 'Nguyễn Văn A', so_nhan: 20, tong_lich: 6, tong_toi: 4, lich_ngay_mai: 3, tong_ds_hnay: 20000000 },
                { name: 'Trần Thị B', so_nhan: 20, tong_lich: 6, tong_toi: 4, lich_ngay_mai: 3, tong_ds_hnay: 15000000 }
            ],
            summaryTemplate: 'BY_EMPLOYEE'
        });

        assert.ok(teleSummary.includes('📊 <b>TỔNG KẾT TELESALE TOÀN ĐỘI NGÀY 17/10/2026</b>'), 'Giữ nguyên tiêu đề tổng kết tele');
        assert.ok(teleSummary.includes('Chi tiết từng nhân sự:'), 'Giữ nguyên chi tiết từng nhân sự');
        assert.ok(teleSummary.includes('Nguyễn Văn A'), 'Có nhân sự A');
        assert.ok(teleSummary.includes('Trần Thị B'), 'Có nhân sự B');
        assert.ok(!teleSummary.includes('THEO DỊCH VỤ'), 'Không áp dụng BY_SERVICE');
    });
    it('submitTelesaleReport tự động bổ sung Dự án mới và Dịch vụ mới vào cấu hình nhóm nếu chưa tồn tại', async () => {
        const { createSubmitTelesaleReport } = await import('../application/submit-telesale-report.js');
        const { DEFAULT_ADS_FIELDS, DEFAULT_SCHEDULE_SETTINGS } = await import('../domain/safe-formula-engine.js');

        let savedConfigProjects = null;
        let savedConfigServices = null;
        const mockRepo = {
            findEmployeeByTelegramId: async () => ({ id: 99, telegram_id: '999', full_name: 'Tester Ads' }),
            getMonthlyPreviousRevenue: async () => 0,
            getFormConfig: async () => ({
                fields: DEFAULT_ADS_FIELDS,
                schedule_settings: DEFAULT_SCHEDULE_SETTINGS,
                features: { has_projects: true, has_services: true },
                projects: ['Dự án Có Sẵn'],
                services: ['Dịch vụ Có Sẵn']
            }),
            saveFormConfig: async ({ telegramGroupId, projects, services }) => {
                if (projects) savedConfigProjects = projects;
                if (services) savedConfigServices = services;
                return { telegram_group_id: telegramGroupId, projects, services };
            },
            upsertDailyReport: async (data) => data,
            getHourlyCumulativeValues: async () => ({})
        };

        const submitReport = createSubmitTelesaleReport({
            telesaleRepository: mockRepo,
            bot: null,
            telesaleSheetSync: null
        });

        const res = await submitReport({
            telegramGroupId: '-10099',
            telegramUserId: '999',
            payload: {
                project_name: 'Dự án Mới Toanh',
                service_name: 'Dịch vụ Mới Toanh',
                report_values: { tong_chi_tieu: 100000, tong_ds: 500000 }
            }
        });

        assert.strictEqual(res.success, true);
        assert.ok(savedConfigProjects, 'Phải gọi saveFormConfig để tự động bổ sung dự án mới');
        assert.deepStrictEqual(savedConfigProjects, ['Dự án Có Sẵn', 'Dự án Mới Toanh']);
        assert.ok(savedConfigServices, 'Phải gọi saveFormConfig để tự động bổ sung dịch vụ mới');
        assert.deepStrictEqual(savedConfigServices, ['Dịch vụ Có Sẵn', 'Dịch vụ Mới Toanh']);
    });


    it('submitTelesaleReport hỗ trợ báo cáo nhiều dịch vụ 1 lần và bot tự động tính tổng hợp tất cả dịch vụ', async () => {
        const { createSubmitTelesaleReport } = await import('../application/submit-telesale-report.js');
        const { DEFAULT_ADS_FIELDS, DEFAULT_SCHEDULE_SETTINGS } = await import('../domain/safe-formula-engine.js');

        const upsertedRows = [];
        let deletedSlotArgs = null;
        let sentMessageText = null;

        const mockRepo = {
            findEmployeeByTelegramId: async () => ({ id: 88, telegram_id: '888', full_name: 'Trần Văn Ads' }),
            getMonthlyPreviousRevenue: async () => 0,
            getFormConfig: async () => ({
                fields: DEFAULT_ADS_FIELDS,
                schedule_settings: DEFAULT_SCHEDULE_SETTINGS,
                features: { has_projects: true, has_services: true, schedule_mode: 'MULTI_SLOT' },
                projects: ['Dự án Thẩm Mỹ Sài Gòn'],
                services: ['Nâng ngực', 'Hút mỡ']
            }),
            saveFormConfig: async () => ({}),
            upsertDailyReport: async (data) => {
                upsertedRows.push(data);
                return data;
            },
            deleteDailyReportsNotInServices: async (args) => {
                deletedSlotArgs = args;
            },
            getHourlyCumulativeValues: async () => ({
                tong_chi_tieu: 500000,
                tong_ds: 2000000
            })
        };

        const mockBot = {
            telegram: {
                sendMessage: async (chatId, text, options) => {
                sentMessageText = text;
                return { message_id: 1234 };
            }
        }
        };

        const submitReport = createSubmitTelesaleReport({
            telesaleRepository: mockRepo,
            bot: mockBot,
            telesaleSheetSync: null
        });

        const res = await submitReport({
            telegramGroupId: '-5492969929',
            telegramUserId: '888',
            reportSlot: '12h',
            payload: {
                report_slot: '12h',
                project_name: 'Dự án Thẩm Mỹ Sài Gòn',
                ghi_chu: 'Chạy ngân sách đều cả 2 mảng',
                services: [
                    {
                        service_name: 'Nâng ngực',
                        report_values: {
                            noi_dung: 'Campaign nâng ngực',
                            tong_chi_tieu: 400000,
                            tong_mess: 20,
                            tong_so: 5,
                            tong_ds: 3000000
                        }
                    },
                    {
                        service_name: 'Nâng mũi',
                        report_values: {
                            noi_dung: 'Campaign nâng mũi cấu trúc',
                            tong_chi_tieu: 300000,
                            tong_mess: 15,
                            tong_so: 4,
                            tong_ds: 2000000
                        }
                    }
                ]
            }
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(upsertedRows.length, 2, 'Phải lưu 2 bản ghi dịch vụ vào DB');
        assert.strictEqual(upsertedRows[0].serviceName, 'Nâng ngực');
        assert.strictEqual(upsertedRows[1].serviceName, 'Nâng mũi');

        assert.ok(deletedSlotArgs, 'Phải gọi deleteDailyReportsNotInServices');
        assert.deepStrictEqual(deletedSlotArgs.keepServices, ['Nâng ngực', 'Nâng mũi']);

        assert.ok(sentMessageText, 'Bot phải gửi tin nhắn về nhóm');
        assert.ok(sentMessageText.includes('BÁO CÁO ADS THEO GIỜ'), 'Tiêu đề Báo cáo Ads theo giờ');
        assert.ok(sentMessageText.includes('12h'), 'Có mốc 12h');
        assert.ok(sentMessageText.includes('🏷 <b>DỊCH VỤ 1: Nâng ngực</b>'), 'Hiển thị chi tiết Dịch vụ 1');
        assert.ok(sentMessageText.includes('🏷 <b>DỊCH VỤ 2: Nâng mũi</b>'), 'Hiển thị chi tiết Dịch vụ 2');
        assert.ok(sentMessageText.includes('🤖 <b>(BOT TỰ ĐỘNG CỘNG TỔNG CÁC DỊCH VỤ)</b>'), 'Có phần BOT tự động cộng tổng các dịch vụ');

        assert.ok(sentMessageText.includes('700.000'), 'Phải cộng tổng chi tiêu hiện tại = 700.000đ');
        assert.ok(sentMessageText.includes('5.000.000'), 'Phải cộng tổng doanh số hiện tại = 5.000.000đ');
        assert.ok(sentMessageText.includes('1.200.000'), 'Tổng chi tiêu cộng dồn = 1.200.000đ');
        assert.ok(sentMessageText.includes('7.000.000'), 'Tổng DS cộng dồn = 7.000.000đ');
        assert.ok(sentMessageText.includes('17.1%'), 'Tỷ lệ % Ads cộng dồn = 17.14%');
    });
});

describe('Telesale Overdue Reminder After 1 Hour (Sau 1h mỗi khung giờ chưa báo cáo thì nhắc)', () => {
    it('calculateLateRemindTime tính chính xác giờ nhắc sau 1 tiếng', async () => {
        const { calculateLateRemindTime } = await import('../domain/safe-formula-engine.js');
        assert.strictEqual(calculateLateRemindTime('09:00', 1), '10:00');
        assert.strictEqual(calculateLateRemindTime('12:00', 1), '13:00');
        assert.strictEqual(calculateLateRemindTime('18:00', 1), '19:00');
        assert.strictEqual(calculateLateRemindTime('09h', 1), '10:00');
        assert.strictEqual(calculateLateRemindTime('23:15', 1), '00:15');
    });

    it('buildTelesaleReminderMessage format chuẩn mẫu nhắc nhở quá hạn 1h theo mốc giờ', async () => {
        const { buildTelesaleReminderMessage } = await import('../domain/telesale-messages.js');
        const overdueMsg = buildTelesaleReminderMessage({
            groupName: '222. BC Ads Đức',
            pendingStaff: [
                { full_name: 'Nguyễn Văn Ads', telegram_id: '123456' },
                { full_name: 'Trần Thị Ads', telegram_id: null }
            ],
            slotId: '09h',
            slotLabel: '09h',
            deadlineTime: '09:00',
            isOverdueReminder: true,
            overdueHours: 1
        });

        assert.ok(overdueMsg.includes('⚠️ <b>NHẮC BÁO CÁO - QUÁ HẠN 1H (MỐC 09h)</b>'));
        assert.ok(overdueMsg.includes('Nhóm: <b>222. BC Ads Đức</b>'));
        assert.ok(overdueMsg.includes('Mốc giờ quy định: <b>09h</b>'));
        assert.ok(overdueMsg.includes('Hạn chót: <b>09:00</b>'));
        assert.ok(overdueMsg.includes('Đã quá 1 giờ'));
        assert.ok(overdueMsg.includes('Nguyễn Văn Ads'));
        assert.ok(overdueMsg.includes('Trần Thị Ads'));
        assert.ok(overdueMsg.includes('bấm nút bên dưới để mở Mini App'));
    });

    it('sendTelesaleReminder lọc đúng người chưa nộp theo slotId và gửi tin nhắc', async () => {
        const { createSendTelesaleReminder } = await import('../application/send-telesale-reminder.js');

        const sentMessages = [];
        const mockBot = {
            telegram: {
                sendMessage: async (chatId, text, extra) => {
                    sentMessages.push({ chatId, text, extra });
                }
            }
        };

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-5492969929', group_name: '222. BC Ads Đức' }
            ],
            findMembersInTelesaleGroup: async () => [
                { id: 'emp-1', full_name: 'Nhân viên 1', telegram_id: 111 },
                { id: 'emp-2', full_name: 'Nhân viên 2', telegram_id: 222 }
            ],
            findReportedEmployeeIds: async (gId, date, slot) => {
                if (slot === '09h') return ['emp-1'];
                return [];
            },
            hasEmployeeWorkedToday: async () => true,
            getFormConfig: async () => ({
                schedule_settings: {
                    slots: [
                        { id: '09h', deadline_time: '09:00', late_remind_time: '10:00' }
                    ]
                }
            }),
            acquireNotificationLock: async () => true
        };

        const reminderFn = createSendTelesaleReminder({
            telesaleRepository: mockRepo,
            bot: mockBot,
            now: () => new Date('2026-10-17T03:00:00Z') // 10:00 VN
        });

        const res = await reminderFn('-5492969929', {
            slotId: '09h',
            slotLabel: '09h',
            deadlineTime: '09:00',
            remindTime: '10:00',
            isOverdueReminder: true,
            overdueHours: 1
        });

        assert.strictEqual(res.success, true);
        assert.strictEqual(sentMessages.length, 1);
        assert.ok(sentMessages[0].text.includes('Nhân viên 2'), 'Chỉ nhắc Nhân viên 2');
        assert.ok(!sentMessages[0].text.includes('Nhân viên 1'), 'Nhân viên 1 đã nộp mốc 09h nên không bị nhắc');
        assert.ok(sentMessages[0].extra.reply_markup.inline_keyboard[0][0].text.includes('Điền Báo Cáo Mốc 09h'));
    });

    it('registerTelesaleCrons kích hoạt nhắc nhở sau 1h của mốc giờ khi currentTime khớp late_remind_time', async () => {
        const { registerTelesaleCrons } = await import('../interfaces/cron/register-telesale-crons.js');
        const cronEvents = [];

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-5492969929', group_name: '222. BC Ads Đức' }
            ],
            getFormConfig: async () => ({
                features: { schedule_mode: 'MULTI_SLOT' },
                schedule_settings: {
                    schedule_mode: 'MULTI_SLOT',
                    overdue_remind_enabled: true,
                    slots: [
                        { id: '09h', label: '09h', deadline_time: '09:00', late_remind_time: '10:00' },
                        { id: '12h', label: '12h', deadline_time: '12:00', late_remind_time: '13:00' }
                    ]
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
            sendTelesaleReminder: async (gId, opts) => cronEvents.push({ gId, opts }),
            scanTelesaleDeadline: async () => {},
            summarizeDailyTelesale: async () => {},
            now: () => new Date('2026-10-17T03:00:00Z') // 10:00 UTC+7 (sau 1h của mốc 09:00)
        });

        await scheduledCallback();
        assert.strictEqual(cronEvents.length, 1);
        assert.strictEqual(cronEvents[0].gId, '-5492969929');
        assert.strictEqual(cronEvents[0].opts.slotId, '09h');
        assert.strictEqual(cronEvents[0].opts.isOverdueReminder, true);
        assert.strictEqual(cronEvents[0].opts.overdueHours, 1);
    });

    it('registerTelesaleCrons và sendTelesaleReminder bỏ qua ngày hôm nay nếu rules_effective_date bắt đầu từ ngày mai', async () => {
        const { registerTelesaleCrons } = await import('../interfaces/cron/register-telesale-crons.js');
        const { createSendTelesaleReminder } = await import('../application/send-telesale-reminder.js');
        const cronEvents = [];

        const mockRepo = {
            findActiveTelesaleGroups: async () => [
                { telegram_group_id: '-5492969929', group_name: '222. BC Ads Đức' }
            ],
            findMembersInTelesaleGroup: async () => [
                { id: 'emp-1', full_name: 'Nhân viên 1' }
            ],
            findReportedEmployeeIds: async () => [],
            hasEmployeeWorkedToday: async () => true,
            getFormConfig: async () => ({
                features: { schedule_mode: 'MULTI_SLOT' },
                schedule_settings: {
                    schedule_mode: 'MULTI_SLOT',
                    rules_effective_date: '2026-10-18',
                    slots: [
                        { id: '18h', label: '18h', deadline_time: '18:00', late_remind_time: '19:00' }
                    ]
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

        // 1. Kiểm tra ngày 2026-10-17 (Hôm nay) -> Phải bỏ qua
        registerTelesaleCrons({
            cron: mockCron,
            telesaleRepository: mockRepo,
            sendTelesaleReminder: async (gId, opts) => cronEvents.push({ gId, opts }),
            scanTelesaleDeadline: async () => {},
            summarizeDailyTelesale: async () => {},
            now: () => new Date('2026-10-17T12:00:00Z') // 19:00 VN ngày 17/10
        });

        await scheduledCallback();
        assert.strictEqual(cronEvents.length, 0, 'Hôm nay 17/10 chưa đến ngày hiệu lực 18/10 nên cron không chạy');

        // sendTelesaleReminder gọi trực tiếp cũng phải bỏ qua
        const reminderFn = createSendTelesaleReminder({
            telesaleRepository: mockRepo,
            bot: { telegram: { sendMessage: async () => {} } },
            now: () => new Date('2026-10-17T12:00:00Z')
        });
        const remRes = await reminderFn('-5492969929');
        assert.strictEqual(remRes.results[0].skipped, true);

        // 2. Kiểm tra ngày 2026-10-18 (Ngày mai) -> Phải kích hoạt
        registerTelesaleCrons({
            cron: mockCron,
            telesaleRepository: mockRepo,
            sendTelesaleReminder: async (gId, opts) => cronEvents.push({ gId, opts }),
            scanTelesaleDeadline: async () => {},
            summarizeDailyTelesale: async () => {},
            now: () => new Date('2026-10-18T12:00:00Z') // 19:00 VN ngày 18/10
        });

        await scheduledCallback();
        assert.strictEqual(cronEvents.length, 1, 'Ngày mai 18/10 đã đến hạn nên phải kích hoạt');
    });
});


