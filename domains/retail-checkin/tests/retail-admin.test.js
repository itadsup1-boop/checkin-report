import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { registerRetailAdminRoutes } from '../interfaces/admin-api/register-retail-admin-routes.js';
import { createGetRetailOverview } from '../application/get-retail-overview.js';
import { createGetRetailMonthlyOverview } from '../application/get-retail-monthly-overview.js';
import { createGetMemberRetailHistory } from '../application/get-member-retail-history.js';
import { createUpdateMemberRetailKpi } from '../application/update-member-retail-kpi.js';

test('Retail Admin Routes - Đăng ký chính xác các endpoint REST API cho Web Admin', () => {
    const routes = [];
    const mockApp = {
        get(route, ...handlers) {
            routes.push({ method: 'GET', route, handler: handlers[handlers.length - 1] });
        },
        put(route, ...handlers) {
            routes.push({ method: 'PUT', route, handler: handlers[handlers.length - 1] });
        }
    };

    registerRetailAdminRoutes({
        app: mockApp,
        repository: {},
        moment
    });

    assert.ok(routes.some(r => r.method === 'GET' && r.route === '/api/admin/retail/groups'), 'Phải có route GET /api/admin/retail/groups');
    assert.ok(routes.some(r => r.method === 'GET' && r.route === '/api/admin/retail/overview'), 'Phải có route GET /api/admin/retail/overview');
    assert.ok(routes.some(r => r.method === 'GET' && r.route === '/api/admin/retail/monthly-overview'), 'Phải có route GET /api/admin/retail/monthly-overview');
    assert.ok(routes.some(r => r.method === 'GET' && r.route === '/api/admin/retail/employees/:employeeId/history'), 'Phải có route GET /api/admin/retail/employees/:employeeId/history');
    assert.ok(routes.some(r => r.method === 'PUT' && r.route === '/api/admin/retail/employees/:employeeId/kpi'), 'Phải có route PUT /api/admin/retail/employees/:employeeId/kpi');
});

test('Retail Overview Use Case - Tính toán chính xác KPI mặc định (15) và KPI tùy chỉnh', async () => {
    const mockRepo = {
        async findRetailGroups() {
            return [{ id: 10, telegram_group_id: '-1001', group_name: 'Comart HN', daily_kpi_target: 15 }];
        },
        async getDailyProgressForGroup(internalGroupId, date, defaultKpi) {
            return [
                {
                    employeeId: 1,
                    employeeName: 'Nguyễn Văn A',
                    employeeRole: 'NV Thị trường',
                    validPoints: 15,
                    targetKpi: 15,
                    customKpi: null,
                    isCompleted: true,
                    lastCheckinTime: '2026-09-07T14:30:00Z',
                    lastStoreName: 'Cửa hàng 15'
                },
                {
                    employeeId: 2,
                    employeeName: 'Trần Thị B',
                    employeeRole: 'NV Thị trường',
                    validPoints: 8,
                    targetKpi: 10,
                    customKpi: 10,
                    isCompleted: false,
                    lastCheckinTime: '2026-09-07T11:00:00Z',
                    lastStoreName: 'Cửa hàng 8'
                },
                {
                    employeeId: 3,
                    employeeName: 'Lê Văn C',
                    employeeRole: 'NV Thị trường',
                    validPoints: 0,
                    targetKpi: 15,
                    customKpi: null,
                    isCompleted: false,
                    lastCheckinTime: null,
                    lastStoreName: null
                }
            ];
        }
    };

    const getRetailOverview = createGetRetailOverview({ repository: mockRepo, moment });
    const overview = await getRetailOverview({
        groupId: '-1001',
        dateStr: '2026-09-07'
    });

    assert.equal(overview.group.groupName, 'Comart HN');
    assert.equal(overview.group.defaultKpi, 15);
    assert.equal(overview.summary.totalMembers, 3);
    assert.equal(overview.summary.completedCount, 1, 'Nhân viên A đạt 15/15');
    assert.equal(overview.summary.inProgressCount, 1, 'Nhân viên B đang làm 8/10');
    assert.equal(overview.summary.notStartedCount, 1, 'Nhân viên C chưa bắt đầu (0)');
    assert.equal(overview.summary.totalPoints, 23);

    const empB = overview.members.find(m => m.employeeId === 2);
    assert.equal(empB.targetKpi, 10);
    assert.equal(empB.customKpi, 10);
    assert.equal(empB.isCompleted, false);

    const empA = overview.members.find(m => m.employeeId === 1);
    assert.equal(empA.targetKpi, 15);
    assert.equal(empA.isCompleted, true);
});

test('Retail History Use Case - Phân loại rõ ràng ngày làm việc ĐỦ và THIẾU', async () => {
    const mockRepo = {
        async getEmployeeRetailHistory(empId, grpId, options) {
            return {
                employee: {
                    employeeId: 1,
                    employeeName: 'Nguyễn Văn A',
                    employeeRole: 'NV Thị trường'
                },
                targetKpi: 15,
                stats: {
                    totalWorkDays: 2,
                    completedDays: 1,
                    incompleteDays: 1,
                    totalPoints: 20
                },
                days: [
                    {
                        date: '2026-09-06',
                        status: 'COMPLETED',
                        isCompleted: true,
                        totalPoints: 15,
                        targetKpi: 15,
                        checkins: []
                    },
                    {
                        date: '2026-09-05',
                        status: 'INCOMPLETE',
                        isCompleted: false,
                        totalPoints: 5,
                        targetKpi: 15,
                        checkins: []
                    }
                ]
            };
        }
    };

    const getMemberRetailHistory = createGetMemberRetailHistory({ repository: mockRepo });
    const historyRes = await getMemberRetailHistory({
        employeeId: 1,
        groupId: '-1001',
        month: '2026-09'
    });

    assert.equal(historyRes.employee.employeeName, 'Nguyễn Văn A');
    assert.equal(historyRes.targetKpi, 15);
    assert.equal(historyRes.stats.totalWorkDays, 2);
    assert.equal(historyRes.stats.completedDays, 1);
    assert.equal(historyRes.stats.incompleteDays, 1);
    assert.equal(historyRes.stats.totalPoints, 20);

    const day1 = historyRes.days.find(d => d.date === '2026-09-06');
    assert.equal(day1.status, 'COMPLETED');
    assert.equal(day1.isCompleted, true);
    assert.equal(day1.totalPoints, 15);

    const day2 = historyRes.days.find(d => d.date === '2026-09-05');
    assert.equal(day2.status, 'INCOMPLETE');
    assert.equal(day2.isCompleted, false);
    assert.equal(day2.totalPoints, 5);
});

test('Retail KPI Update - Kiểm tra tính hợp lệ số nguyên dương và cập nhật DB', async () => {
    let savedData = null;
    const mockRepo = {
        async upsertEmployeeKpi(empId, grpId, kpi) {
            savedData = { empId, grpId, kpi };
            return { employee_id: empId, telegram_group_id: grpId, daily_kpi_target: kpi };
        }
    };

    const updateMemberRetailKpi = createUpdateMemberRetailKpi({ repository: mockRepo });

    // Case hợp lệ: set KPI = 12
    const res = await updateMemberRetailKpi({
        employeeId: 10,
        telegramGroupId: '-1001',
        dailyKpiTarget: 12
    });
    assert.equal(res.success, true);
    assert.equal(savedData.kpi, 12);

    // Case reset về mặc định: KPI = null
    const resReset = await updateMemberRetailKpi({
        employeeId: 10,
        telegramGroupId: '-1001',
        dailyKpiTarget: null
    });
    assert.equal(resReset.success, true);
    assert.equal(savedData.kpi, null);

    // Case lỗi: KPI âm hoặc bằng 0
    await assert.rejects(
        async () => {
            await updateMemberRetailKpi({
                employeeId: 10,
                telegramGroupId: '-1001',
                dailyKpiTarget: -5
            });
        },
        { status: 400 }
    );
});

test('Retail Monthly Overview Use Case - Tổng hợp dữ liệu cả tháng toàn nhóm', async () => {
    const mockRepo = {
        async findRetailGroups() {
            return [{ id: 10, telegram_group_id: '-1001', group_name: 'Comart HN', daily_kpi_target: 15 }];
        },
        async getMonthlyProgressForGroup(groupId, monthStr, defaultKpi) {
            return {
                month: monthStr,
                summary: {
                    totalMembers: 2,
                    totalPoints: 125,
                    totalWorkDays: 10,
                    totalCompletedDays: 8,
                    overallCompletionRate: 80,
                    activeMembersCount: 2
                },
                members: [
                    {
                        employeeId: 1,
                        employeeName: 'Nguyễn Văn A',
                        targetKpi: 15,
                        totalWorkDays: 6,
                        completedDays: 5,
                        incompleteDays: 1,
                        totalPoints: 80,
                        completionRate: 83
                    },
                    {
                        employeeId: 2,
                        employeeName: 'Trần Thị B',
                        targetKpi: 15,
                        totalWorkDays: 4,
                        completedDays: 3,
                        incompleteDays: 1,
                        totalPoints: 45,
                        completionRate: 75
                    }
                ]
            };
        }
    };

    const getRetailMonthlyOverview = createGetRetailMonthlyOverview({ repository: mockRepo, moment });
    const overview = await getRetailMonthlyOverview({
        groupId: '-1001',
        monthStr: '2026-09'
    });

    assert.equal(overview.month, '2026-09');
    assert.equal(overview.summary.totalMembers, 2);
    assert.equal(overview.summary.totalPoints, 125);
    assert.equal(overview.summary.totalWorkDays, 10);
    assert.equal(overview.summary.totalCompletedDays, 8);
    assert.equal(overview.summary.overallCompletionRate, 80);
    assert.equal(overview.members.length, 2);
    assert.equal(overview.members[0].employeeName, 'Nguyễn Văn A');
    assert.equal(overview.members[0].totalPoints, 80);
    assert.equal(overview.members[0].completionRate, 83);
});

