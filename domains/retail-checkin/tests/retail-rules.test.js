import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import {
    parseCheckinCaption,
    validateCheckinPhotos,
    calculateKpiProgress,
    validateWorkingHours,
    RETAIL_CONFIG
} from '../domain/checkin-rules.js';

import {
    buildCheckinSuccessMessage,
    buildCheckinErrorMessage,
    buildDailySummaryMessage,
    buildOneHourProgressReminderMessage
} from '../domain/retail-messages.js';

import { formatLocationCell, ensureGpsHeader, HEADERS } from '../infrastructure/google-sheet/retail-sheet.js';
import { createRetailRepository } from '../infrastructure/postgres/retail-repository.js';
import { registerRetailTelegramHandler } from '../interfaces/telegram/register-retail-handler.js';


test('Retail Rules - parseCheckinCaption bóc tách đúng định dạng', () => {
    // Có dấu ngoặc vuông
    const parsed1 = parseCheckinCaption('[Tạp hóa Minh Phát] - [123 Đường Nguyễn Trãi, Quận 1]');
    assert.deepEqual(parsed1, {
        storeName: 'Tạp hóa Minh Phát',
        storeAddress: '123 Đường Nguyễn Trãi, Quận 1'
    });

    // Không có dấu ngoặc vuông
    const parsed2 = parseCheckinCaption('Cửa hàng Sữa Mẹ Bé - 45 Phố Huế, Hai Bà Trưng, Hà Nội');
    assert.deepEqual(parsed2, {
        storeName: 'Cửa hàng Sữa Mẹ Bé',
        storeAddress: '45 Phố Huế, Hai Bà Trưng, Hà Nội'
    });

    // Thiếu địa chỉ sau dấu gạch -> từ chối (null)
    assert.equal(parseCheckinCaption('Đại lý Tuấn Anh - '), null);
    assert.equal(parseCheckinCaption('Đại lý Tuấn Anh -   '), null);

    // Sai định dạng: Không có dấu gạch ngang
    assert.equal(parseCheckinCaption('Check in tại tạp hóa Minh Phát'), null);
    assert.equal(parseCheckinCaption(''), null);
    assert.equal(parseCheckinCaption(null), null);
    assert.equal(parseCheckinCaption('A - B'), null); // storeName quá ngắn (< 2 ký tự)
});

test('Retail Rules - validateCheckinPhotos kiểm tra đủ tối thiểu 1 ảnh', () => {
    assert.equal(validateCheckinPhotos(0).valid, false);
    assert.equal(validateCheckinPhotos(1).valid, true);
    assert.equal(validateCheckinPhotos(2).valid, true);
    assert.equal(validateCheckinPhotos(3).valid, true);
});

test('Retail Rules - calculateKpiProgress tính đúng mốc 15 điểm', () => {
    const p1 = calculateKpiProgress(1);
    assert.equal(p1.completed, false);
    assert.equal(p1.remaining, 14);
    assert.equal(p1.progressText, '1/15');

    const p14 = calculateKpiProgress(14);
    assert.equal(p14.completed, false);
    assert.equal(p14.remaining, 1);
    assert.equal(p14.progressText, '14/15');

    const p15 = calculateKpiProgress(15);
    assert.equal(p15.completed, true);
    assert.equal(p15.remaining, 0);
    assert.equal(p15.progressText, '15/15');

    const p17 = calculateKpiProgress(17);
    assert.equal(p17.completed, true);
    assert.equal(p17.remaining, 0);
    assert.equal(p17.progressText, '17/15');
});

test('Retail Messages - buildCheckinSuccessMessage tạo nội dung thông báo đầy đủ', () => {
    const msg = buildCheckinSuccessMessage({
        employeeName: 'Nguyễn Văn A',
        storeName: 'Tạp hóa Minh Phát',
        storeAddress: '123 Nguyễn Trãi',
        timeStr: '09:15:00 - 05/09/2026',
        currentPoints: 5,
        targetPoints: 15,
        remainingPoints: 10,
        completed: false
    });

    assert.ok(msg.includes('Nguyễn Văn A'));
    assert.ok(msg.includes('Tạp hóa Minh Phát'));
    assert.ok(msg.includes('5/15'));
    assert.ok(msg.includes('Còn thiếu: <b>10 điểm</b>'));
});

test('Retail Messages - buildDailySummaryMessage tổng hợp chính xác đạt và chưa đạt', () => {
    const results = [
        { employeeName: 'Trần Văn B', validPoints: 15, isCompleted: true },
        { employeeName: 'Lê Thị C', validPoints: 12, isCompleted: false }
    ];

    const summary = buildDailySummaryMessage({
        dateStr: '05/09/2026',
        results
    });

    assert.ok(summary.includes('Trần Văn B: <b>15/15 điểm</b>'));
    assert.ok(summary.includes('Lê Thị C: 12/15 điểm (Thiếu 3)'));
});

test('Retail Rules - validateWorkingHours kiểm tra chính xác ngày và giờ làm việc', () => {
    // 1. Ngày Chủ Nhật (2026-09-06 là Chủ Nhật)
    const sundayMorning = moment('2026-09-06T10:00:00+07:00');
    const resSunday = validateWorkingHours(sundayMorning);
    assert.equal(resSunday.isWorkingHour, false);
    assert.ok(resSunday.message.includes('Chủ Nhật'));

    // 2. Thứ Hai trước giờ bắt đầu (06:00 sáng < 08:30) -> Cho phép gửi và ghi nhận
    const mondayEarly = moment('2026-09-07T06:00:00+07:00');
    const resEarly = validateWorkingHours(mondayEarly);
    assert.equal(resEarly.isWorkingHour, true);
    assert.equal(resEarly.isEarly, true);

    // 3. Thứ Hai sau giờ kết thúc (19:30 tối > 18:00) -> Cho phép gửi và ghi nhận
    const mondayLate = moment('2026-09-07T19:30:00+07:00');
    const resLate = validateWorkingHours(mondayLate);
    assert.equal(resLate.isWorkingHour, true);
    assert.equal(resLate.isOvertime, true);

    // 4. Thứ Hai trong giờ làm việc (10:00 sáng)
    const mondayWorking = moment('2026-09-07T10:00:00+07:00');
    const resWorking = validateWorkingHours(mondayWorking);
    assert.equal(resWorking.isWorkingHour, true);
    assert.equal(resWorking.isLunchBreak, false);

    // 5. Thứ Hai trong giờ nghỉ trưa (12:30 trưa)
    const mondayLunch = moment('2026-09-07T12:30:00+07:00');
    const resLunch = validateWorkingHours(mondayLunch);
    assert.equal(resLunch.isWorkingHour, true);
    assert.equal(resLunch.isLunchBreak, true);
    assert.ok(resLunch.message.includes('nghỉ trưa'));

    // 6. Tùy biến giờ ca theo nhóm (ví dụ 07:00 - 16:00)
    const customTime = moment('2026-09-07T07:30:00+07:00');
    const resCustom = validateWorkingHours(customTime, '07:00', '16:00');
    assert.equal(resCustom.isWorkingHour, true);

    // 7. Chốt sổ lúc 20:00 (Đúng 20:00 không nhận thêm)
    const mondayCutoff = moment('2026-09-07T20:00:00+07:00');
    const resCutoff = validateWorkingHours(mondayCutoff);
    assert.equal(resCutoff.isWorkingHour, false);
    assert.equal(resCutoff.isCutoff, true);
    assert.ok(resCutoff.message.includes('20:00'));

    // 8. Sau 20:00 (20:30 tối không nhận thêm)
    const mondayPostCutoff = moment('2026-09-07T20:30:00+07:00');
    const resPostCutoff = validateWorkingHours(mondayPostCutoff);
    assert.equal(resPostCutoff.isWorkingHour, false);
    assert.equal(resPostCutoff.isCutoff, true);
});

test('Process Store Checkin - Chặn check-in vào ngày Chủ Nhật và ngoài giờ làm việc', async () => {
    const { createProcessStoreCheckin } = await import('../application/process-store-checkin.js');
    let insertedRecord = null;
    const mockRepo = {
        async findEmployeeByTelegramId(id) {
            return { id: 1, full_name: 'Nguyễn Văn Test', telegram_id: id };
        },
        async findGroupByTelegramId(id) {
            return { id: 10, telegram_group_id: id, group_name: 'TEST GROUP', shift_start_time: '08:30:00', shift_end_time: '18:00:00' };
        },
        async insertCheckin(data) {
            insertedRecord = data;
            return 1;
        }
    };

    // 1. Giả lập Chủ Nhật
    const processSunday = createProcessStoreCheckin({
        repository: mockRepo,
        sheetSync: { syncCheckin: async () => {} },
        moment: () => moment('2026-09-06T10:00:00+07:00')
    });

    const resSunday = await processSunday({
        telegramId: '123',
        telegramGroupId: '-1001',
        caption: 'Tạp hóa An Bình - 123 Lê Lợi',
        photos: [{ file_id: 'p1' }, { file_id: 'p2' }]
    });

    assert.equal(resSunday.success, false);
    assert.ok(resSunday.replyText.includes('Chủ Nhật'));
    assert.equal(insertedRecord.isValid, false);
    assert.ok(insertedRecord.rejectReason.includes('Chủ Nhật'));

    // 2. Giả lập ngoài giờ làm việc (19:30 tối) -> Vẫn cho phép gửi và ghi nhận hợp lệ
    const processLate = createProcessStoreCheckin({
        repository: {
            ...mockRepo,
            async countDailyValidCheckins() { return 1; },
            async upsertDailySummary() { return 1; },
            async findLastCheckin() { return null; }
        },
        sheetSync: { syncCheckin: async () => {} },
        moment: () => moment('2026-09-07T19:30:00+07:00')
    });

    const resLate = await processLate({
        telegramId: '123',
        telegramGroupId: '-1001',
        caption: 'Tạp hóa An Bình - 123 Lê Lợi',
        photos: [{ file_id: 'p1' }, { file_id: 'p2' }]
    });

    assert.equal(resLate.success, true);
    assert.ok(resLate.replyText.includes('XÁC NHẬN CHECK-IN ĐIỂM BÁN HỢP LỆ'));
    assert.equal(insertedRecord.isValid, true);
});

test('Retail Messages - buildOneHourProgressReminderMessage thống kê rõ ràng số điểm còn thiếu', () => {
    const progressList = [
        { employeeName: 'Nguyễn Văn A', validPoints: 10, isCompleted: false },
        { employeeName: 'Trần Thị B', validPoints: 15, isCompleted: true }
    ];

    const msg = buildOneHourProgressReminderMessage({
        dateStr: '06/09/2026',
        currentTime: '17:00',
        shiftEndTime: '18:00',
        progressList,
        targetPoints: 15
    });

    assert.ok(msg.includes('CÒN 1 TIẾNG HẾT GIỜ LÀM'));
    assert.ok(msg.includes('Nguyễn Văn A'));
    assert.ok(msg.includes('10/15 điểm'));
    assert.ok(msg.includes('Còn thiếu: <b>5 điểm</b>'));
    assert.ok(msg.includes('Trần Thị B'));
    assert.ok(msg.includes('Đạt 100%'));
});

test('Retail Closing 20:00 - summarizeDailyKpi cập nhật Database, Google Sheet và gửi báo cáo Telegram', async () => {
    const { createSummarizeDailyKpi } = await import('../application/summarize-daily-kpi.js');

    const dbSummaries = [];
    let syncedSheet = null;
    let sentTelegramMsg = null;

    const mockRepo = {
        async findRetailGroups() {
            return [{
                id: 'grp-1',
                group_name: 'Nhóm Test',
                telegram_group_id: '-100123',
                daily_kpi_target: 15
            }];
        },
        async getDailyProgressForGroup(groupId, dateStr, kpiTarget) {
            return [
                { employeeId: 'emp-1', employeeName: 'Nguyễn Văn Đạt', validPoints: 15, isCompleted: true },
                { employeeId: 'emp-2', employeeName: 'Trần Văn Thiếu', validPoints: 11, isCompleted: false }
            ];
        },
        async upsertDailySummary(data) {
            dbSummaries.push(data);
            return 'summary-id';
        }
    };

    const mockSheetSync = {
        async syncDailyClosing(groupId, data) {
            syncedSheet = { groupId, data };
        }
    };

    const mockBot = {
        telegram: {
            async sendMessage(chatId, text, opts) {
                sentTelegramMsg = { chatId, text, opts };
            }
        }
    };

    const summarize = createSummarizeDailyKpi({
        repository: mockRepo,
        bot: mockBot,
        moment: () => moment('2026-09-06T20:00:00+07:00'),
        sheetSync: mockSheetSync
    });

    await summarize();

    // 1. Kiểm tra Database đã được cập nhật
    assert.equal(dbSummaries.length, 2);
    assert.equal(dbSummaries[0].employeeId, 'emp-1');
    assert.equal(dbSummaries[0].isCompleted, true);
    assert.equal(dbSummaries[0].status, 'COMPLETED');
    assert.equal(dbSummaries[1].employeeId, 'emp-2');
    assert.equal(dbSummaries[1].isCompleted, false);
    assert.equal(dbSummaries[1].status, 'INCOMPLETE');

    // 2. Kiểm tra Google Sheet đã được gọi đồng bộ
    assert.ok(syncedSheet);
    assert.equal(syncedSheet.groupId, '-100123');
    assert.equal(syncedSheet.data.closingList.length, 2);

    // 3. Kiểm tra Telegram đã nhận tin nhắn báo cáo chốt sổ 20:00
    assert.ok(sentTelegramMsg);
    assert.equal(sentTelegramMsg.chatId, '-100123');
    assert.ok(sentTelegramMsg.text.includes('CHỐT 20:00'));
    assert.ok(sentTelegramMsg.text.includes('Trần Văn Thiếu'));
    assert.ok(sentTelegramMsg.text.includes('CHƯA ĐỦ'));
    assert.ok(sentTelegramMsg.text.includes('Nguyễn Văn Đạt'));
    assert.ok(sentTelegramMsg.text.includes('GỬI ĐỦ'));
});

test('Retail Start Date - summarizeDailyKpi và sendProgressReminders bỏ qua khi chưa đến start_date và chạy bình thường từ start_date', async () => {
    const { createSummarizeDailyKpi } = await import('../application/summarize-daily-kpi.js');
    const { createSendProgressReminders } = await import('../application/send-progress-reminders.js');

    let telegramCalls = 0;
    const mockBot = {
        telegram: {
            async sendMessage() {
                telegramCalls++;
            }
        }
    };

    // Nhóm áp dụng từ ngày mai 2026-09-08
    const mockRepoFutureStart = {
        async findRetailGroups() {
            return [{ 
                id: 'grp-0', 
                group_name: 'Nhóm Comart', 
                telegram_group_id: '-1000', 
                daily_kpi_target: 15, 
                start_date: '2026-09-08',
                auto_reminder_enabled: true 
            }];
        },
        async getDailyProgressForGroup() {
            return [
                { employeeId: 'emp-1', employeeName: 'Nhân viên 1', validPoints: 0, isCompleted: false },
                { employeeId: 'emp-2', employeeName: 'Nhân viên 2', validPoints: 0, isCompleted: false }
            ];
        },
        async upsertDailySummary() {}
    };

    // 1. Ngày hôm nay (2026-09-07 < 2026-09-08) -> Bỏ qua, không gửi
    const summarizeBefore = createSummarizeDailyKpi({
        repository: mockRepoFutureStart,
        bot: mockBot,
        moment: () => moment('2026-09-07T20:00:00+07:00'),
        sheetSync: {}
    });
    await summarizeBefore();
    assert.equal(telegramCalls, 0, 'summarizeDailyKpi phải bỏ qua khi chưa đến start_date');

    const reminderBefore = createSendProgressReminders({
        repository: mockRepoFutureStart,
        bot: mockBot,
        moment: () => moment('2026-09-07T17:00:00+07:00')
    });
    await reminderBefore({ type: 'one_hour_warning' });
    assert.equal(telegramCalls, 0, 'sendProgressReminders phải bỏ qua khi chưa đến start_date');

    // 2. Ngày mai (2026-09-08 >= 2026-09-08) -> Chạy bình thường, gửi nhắc nhở và chốt sổ
    const reminderOn = createSendProgressReminders({
        repository: mockRepoFutureStart,
        bot: mockBot,
        moment: () => moment('2026-09-08T17:00:00+07:00')
    });
    await reminderOn({ type: 'one_hour_warning' });
    assert.equal(telegramCalls, 1, 'sendProgressReminders phải gửi nhắc nhở khi đến start_date');

    const summarizeOn = createSummarizeDailyKpi({
        repository: mockRepoFutureStart,
        bot: mockBot,
        moment: () => moment('2026-09-08T20:00:00+07:00'),
        sheetSync: {}
    });
    await summarizeOn();
    assert.equal(telegramCalls, 2, 'summarizeDailyKpi phải gửi chốt sổ khi đến start_date');
});

test('Retail GPS - formatLocationCell tạo đúng công thức HYPERLINK cho Google Sheets', () => {
    // 1. Có đầy đủ toạ độ và Google Maps URL với locale en
    const cellEn = formatLocationCell(21.028511, 105.854444, 'https://maps.google.com/?q=21.028511,105.854444', 15.5, 'en');
    assert.strictEqual(cellEn, '=HYPERLINK("https://maps.google.com/?q=21.028511,105.854444", "📍 Xem vị trí (±16m)")');

    // 2. Locale tiếng Việt (dấu chấm phẩy ngăn cách)
    const cellVn = formatLocationCell(21.028511, 105.854444, 'https://maps.google.com/?q=21.028511,105.854444', null, 'vi_VN');
    assert.strictEqual(cellVn, '=HYPERLINK("https://maps.google.com/?q=21.028511,105.854444"; "📍 Xem vị trí")');

    // 3. Tự tạo URL Google Maps nếu không truyền googleMapsUrl (mặc định locale vi_VN)
    const cellAutoUrl = formatLocationCell(10.776889, 106.700806, null, 8);
    assert.strictEqual(cellAutoUrl, '=HYPERLINK("https://maps.google.com/?q=10.776889,106.700806"; "📍 Xem vị trí (±8m)")');

    // 4. Không có toạ độ -> trả về rỗng
    const cellEmpty = formatLocationCell(null, null, null);
    assert.strictEqual(cellEmpty, '');
});

test('Retail GPS - ensureGpsHeader thêm cột Định vị GPS vào bảng tính nếu chưa có', async () => {
    assert.ok(HEADERS.includes('Định vị GPS'), 'HEADERS phải có cột Định vị GPS');

    let insertedHeaders = null;

    const mockSheet = {
        headerValues: ['Mã NV', 'Họ và tên', 'Tên cửa hàng / Điểm bán', 'Địa chỉ', 'Ảnh selfie', 'Ảnh quầy kệ', 'Trạng thái', 'Lý do'],
        async loadHeaderRow() {
            // nạp header
        },
        async setHeaderRow(headers) {
            insertedHeaders = headers;
        }
    };

    await ensureGpsHeader(mockSheet);

    assert.ok(insertedHeaders.includes('Định vị GPS'), 'Phải chèn thêm cột Định vị GPS');
    const gpsIndex = insertedHeaders.indexOf('Định vị GPS');
    const statusIndex = insertedHeaders.indexOf('Trạng thái');
    assert.ok(gpsIndex < statusIndex, 'Cột Định vị GPS phải đứng trước Trạng thái');
});

test('Retail GPS - Repository insertCheckin lưu đúng 4 cột GPS vào Database', async () => {
    let executedQuery = null;
    let executedParams = null;

    const mockPool = {
        query: async (text, params) => {
            executedQuery = text;
            executedParams = params;
            return {
                rows: [{ id: 99 }]
            };
        }
    };

    const repo = createRetailRepository({ pool: mockPool });

    const resultId = await repo.insertCheckin({
        groupId: 1,
        employeeId: 2,
        storeName: 'Cửa hàng Test',
        storeAddress: '123 Phố Huế',
        selfiePhotoUrl: 'https://example.com/selfie.jpg',
        storePhotoUrl: 'https://example.com/shelf1.jpg',
        mediaUrls: [],
        checkinTime: '10:30:00',
        checkinDate: '2026-09-08',
        isValid: true,
        rejectReason: null,
        photoHashes: [],
        driveFolderUrl: null,
        latitude: 21.028511,
        longitude: 105.854444,
        locationAccuracy: 12.5,
        googleMapsUrl: null
    });

    assert.ok(executedQuery.includes('latitude'), 'Query INSERT phải chứa cột latitude');
    assert.ok(executedQuery.includes('longitude'), 'Query INSERT phải chứa cột longitude');
    assert.ok(executedQuery.includes('location_accuracy'), 'Query INSERT phải chứa cột location_accuracy');
    assert.ok(executedQuery.includes('google_maps_url'), 'Query INSERT phải chứa cột google_maps_url');

    assert.strictEqual(executedParams[13], 21.028511);
    assert.strictEqual(executedParams[14], 105.854444);
    assert.strictEqual(executedParams[15], 12.5);
    assert.strictEqual(executedParams[16], 'https://maps.google.com/?q=21.028511,105.854444');
    assert.strictEqual(resultId, 99);
});

test('Retail GPS - Telegram Handler ghi nhận location message khi nhân viên gửi toạ độ', async () => {
    const listeners = {};
    const mockBot = {
        on: (events, handler) => {
            const arr = Array.isArray(events) ? events : [events];
            arr.forEach(e => { listeners[e] = handler; });
        }
    };

    registerRetailTelegramHandler({
        bot: mockBot,
        repository: {},
        sheetSync: {},
        moment,
        getGroupRole: async () => 'retail_checkin'
    });

    assert.ok(typeof listeners['location'] === 'function', 'Phải đăng ký listener cho sự kiện location');

    let repliedMsg = null;
    const mockCtx = {
        chat: { id: -100999, type: 'supergroup' },
        message: {
            message_id: 123,
            from: { id: 778899, first_name: 'Minh' },
            location: {
                latitude: 20.9999,
                longitude: 105.8888,
                horizontal_accuracy: 10
            }
        },
        reply: async (text) => { repliedMsg = text; }
    };

    await listeners['location'](mockCtx, () => {});

    assert.ok(repliedMsg.includes('Đã nhận tọa độ GPS'), 'Bot phải phản hồi xác nhận toạ độ');
    assert.ok(repliedMsg.includes('20.9999'), 'Phản hồi phải có vĩ độ');
    assert.ok(repliedMsg.includes('105.8888'), 'Phản hồi phải có kinh độ');
});



