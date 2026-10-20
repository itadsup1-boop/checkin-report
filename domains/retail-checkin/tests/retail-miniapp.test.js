import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import moment from 'moment';
import { RETAIL_CONFIG } from '../domain/checkin-rules.js';
import { registerRetailMiniappRoutes } from '../interfaces/miniapp-api/register-retail-miniapp-routes.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, '../../../apps/bot/public');

test('Retail Mini App - File HTML tồn tại và có đầy đủ cấu trúc UI/UX mô-đun hóa', () => {
    const htmlPath = path.join(publicDir, 'retail_checkin.html');
    const jsPath = path.join(publicDir, 'retail/app.js');
    const cssPath = path.join(publicDir, 'retail/theme.css');

    assert.ok(fs.existsSync(htmlPath), 'File retail_checkin.html phải tồn tại');
    assert.ok(fs.existsSync(jsPath), 'File retail/app.js phải tồn tại');
    assert.ok(fs.existsSync(cssPath), 'File retail/theme.css phải tồn tại');

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const combined = htmlContent + '\n' + jsContent;

    assert.ok(htmlContent.includes('Check-in Tuyến Điểm Bán'), 'Phải có tiêu đề Check-in Tuyến Điểm Bán');
    assert.ok(htmlContent.includes('15 điểm'), 'Phải hiển thị KPI mục tiêu 15 điểm');
    assert.ok(htmlContent.includes('fileSelfie'), 'Phải có ô chọn ảnh selfie cổng');
    assert.ok(htmlContent.includes('fileStore'), 'Phải có ô chọn ảnh quầy kệ bên trong');
    assert.ok(htmlContent.includes('tabBtnHistory'), 'Phải có tab lịch sử');
    assert.ok(htmlContent.includes('historyDateInput'), 'Phải có input chọn ngày lịch sử');

    assert.ok(combined.includes('storeNameInput'), 'Phải có input tên cửa hàng');
    assert.ok(combined.includes('storeAddressInput'), 'Phải có input địa chỉ cửa hàng');
    assert.ok(combined.includes('/api/retail-checkin/submit'), 'Phải gọi API submit');
    assert.ok(combined.includes('/api/retail-checkin/bootstrap'), 'Phải gọi API bootstrap');
    assert.ok(combined.includes('/api/retail-checkin/history'), 'Phải gọi API history');
});

test('Retail Mini App Routes - Đăng ký chính xác các endpoint REST API', () => {
    const routes = [];
    const mockApp = {
        get(route, ...handlers) {
            routes.push({ method: 'GET', route, handler: handlers[handlers.length - 1] });
        },
        post(route, ...handlers) {
            routes.push({ method: 'POST', route, handler: handlers[handlers.length - 1] });
        }
    };

    registerRetailMiniappRoutes({
        botApp: mockApp,
        bot: {},
        repository: {},
        sheetSync: {},
        moment,
        crypto: null,
        fs: null,
        retailUploadDir: '/tmp'
    });

    const bootstrapRoute = routes.find(r => r.method === 'GET' && r.route === '/api/retail-checkin/bootstrap');
    assert.ok(bootstrapRoute, 'Endpoint GET /api/retail-checkin/bootstrap phải được đăng ký');

    const historyRoute = routes.find(r => r.method === 'GET' && r.route === '/api/retail-checkin/history');
    assert.ok(historyRoute, 'Endpoint GET /api/retail-checkin/history phải được đăng ký');

    const submitRoute = routes.find(r => r.method === 'POST' && r.route === '/api/retail-checkin/submit');
    assert.ok(submitRoute, 'Endpoint POST /api/retail-checkin/submit phải được đăng ký');
});

test('Retail Mini App Routes - Bootstrap trả đúng thông tin nhân viên và tiến độ KPI', async () => {
    let capturedBootstrapHandler = null;
    const mockApp = {
        get(route, handler) {
            if (route === '/api/retail-checkin/bootstrap') capturedBootstrapHandler = handler;
        },
        post() {}
    };

    const mockRepo = {
        async findEmployeeByTelegramId(id) {
            if (id === '12345') {
                return { id: 10, full_name: 'Nguyễn Văn Test', role: 'retail_checkin' };
            }
            return null;
        },
        async findGroupByTelegramId(id) {
            return { id: 5, telegram_group_id: id, group_name: 'TEST GROUP', daily_kpi_target: 15 };
        },
        async findTodayCheckins(employeeId, dateStr) {
            return [{ id: 1 }, { id: 2 }, { id: 3 }];
        }
    };

    registerRetailMiniappRoutes({
        botApp: mockApp,
        bot: {},
        repository: mockRepo,
        sheetSync: {},
        moment,
        crypto: null,
        fs: null,
        retailUploadDir: '/tmp'
    });

    assert.ok(capturedBootstrapHandler, 'Handler bootstrap phải tồn tại');

    // Test trường hợp tài khoản hợp lệ
    let responseData = null;
    const mockRes = {
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            responseData = data;
            return this;
        }
    };

    await capturedBootstrapHandler({ query: { telegram_id: '12345', chat_id: '-100999' } }, mockRes);
    assert.equal(responseData.ok, true);
    assert.equal(responseData.isRegistered, true);
    assert.equal(responseData.employee.fullName, 'Nguyễn Văn Test');
    assert.equal(responseData.progress.todayCount, 3);
    assert.equal(responseData.progress.target, 15);
    assert.equal(responseData.progress.remaining, 12);
    assert.equal(responseData.progress.isCompleted, false);

    // Test trường hợp chưa duyệt / chưa đăng ký
    await capturedBootstrapHandler({ query: { telegram_id: '99999', chat_id: '-100999' } }, mockRes);
    assert.equal(responseData.ok, false);
    assert.equal(responseData.isRegistered, false);
});

test('Retail Mini App Routes - Submit kiểm tra chặn spam 120s và xử lý check-in thành công', async () => {
    let capturedSubmitHandler = null;
    const mockApp = {
        get() {},
        post(route, ...handlers) {
            if (route === '/api/retail-checkin/submit') {
                capturedSubmitHandler = handlers[handlers.length - 1];
            }
        }
    };

    let insertedRecord = null;
    let upsertSummaryCall = null;
    let sheetSyncCall = null;
    let telegramMediaSent = null;

    const mockWorkMoment = (inp) => {
        if (!inp) {
            // Giả lập Thứ Hai lúc 10:00:00 (trong khung giờ 08:30 - 18:00)
            return moment('2026-09-07T10:00:00+07:00');
        }
        return moment(inp);
    };

    const mockRepo = {
        async findEmployeeByTelegramId(id) {
            return { id: 10, full_name: 'Trần Văn Thị Trường', role: 'retail_checkin' };
        },
        async findGroupByTelegramId(id) {
            return { id: 5, telegram_group_id: id, group_name: 'TEST GROUP' };
        },
        async findLastCheckin(employeeId) {
            // Giả lập check-in gần nhất cách đây 30 giây (trong ngưỡng chặn 120s)
            return {
                id: 99,
                checkin_time: mockWorkMoment().subtract(30, 'seconds').toISOString()
            };
        },
        async findTodayCheckins() {
            return [];
        },
        async insertCheckin(data) {
            insertedRecord = data;
            return { id: 100, ...data };
        },
        async upsertDailySummary(data) {
            upsertSummaryCall = data;
            return { id: 200, ...data };
        }
    };

    const mockSheetSync = {
        async syncCheckin(groupId, data) {
            sheetSyncCall = { groupId, data };
        }
    };

    const mockBot = {
        telegram: {
            async sendMediaGroup(chatId, media) {
                telegramMediaSent = { chatId, media };
                return [
                    { photo: [{ file_id: 'selfie_file_id_test' }] },
                    { photo: [{ file_id: 'store_file_id_test' }] }
                ];
            }
        }
    };

    const mockFs = {
        existsSync() { return true; },
        unlinkSync() {},
        readFileSync() { return Buffer.from('fake_image_bytes'); }
    };

    registerRetailMiniappRoutes({
        botApp: mockApp,
        bot: mockBot,
        repository: mockRepo,
        sheetSync: mockSheetSync,
        moment: mockWorkMoment,
        crypto: null,
        fs: mockFs,
        retailUploadDir: '/tmp'
    });

    let resData = null;
    let resStatus = 200;
    const createRes = () => {
        resStatus = 200;
        resData = null;
        return {
            status(code) { resStatus = code; return this; },
            json(data) { resData = data; return this; }
        };
    };

    // 1. Kiểm tra cơ chế chặn spam khi bật cấu hình (> 0)
    RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS = 120;
    const reqSpam = {
        body: {
            telegram_id: '8634311806',
            chat_id: '-5488818649',
            store_name: 'Tạp hóa Bình An',
            store_address: '100 Lê Lợi'
        },
        files: {
            photo_selfie: [{ path: '/tmp/s.jpg' }],
            photo_store: [{ path: '/tmp/st.jpg' }]
        }
    };

    await capturedSubmitHandler(reqSpam, createRes());
    assert.equal(resStatus, 429, 'Phải trả về 429 Too Many Requests khi bật cấu hình spam < 120s');

    // Tắt giới hạn theo yêu cầu vận hành (MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS = 0)
    RETAIL_CONFIG.MIN_INTERVAL_BETWEEN_CHECKINS_SECONDS = 0;

    // 2. Test gửi thành công khi bỏ giới hạn (thậm chí khi điểm trước vừa gửi cách đây 30s)
    mockRepo.findLastCheckin = async () => ({
        id: 99,
        checkin_time: mockWorkMoment().subtract(30, 'seconds').toISOString()
    });

    const reqSuccess = {
        body: {
            telegram_id: '8634311806',
            chat_id: '-5488818649',
            store_name: 'Tạp hóa Bình An',
            store_address: '100 Lê Lợi'
        },
        files: {
            photo_selfie: [{ path: '/tmp/s.jpg' }],
            photo_store: [{ path: '/tmp/st.jpg' }]
        }
    };

    await capturedSubmitHandler(reqSuccess, createRes());
    assert.equal(resStatus, 200, 'Check-in hợp lệ phải trả về status 200');
    assert.equal(resData.ok, true);
    assert.equal(resData.success, true);
    assert.equal(resData.progress.todayCount, 1);
    assert.equal(resData.progress.target, 15);
    assert.equal(resData.progress.remaining, 14);

    // Kiểm tra đã lưu DB và đồng bộ Sheet
    assert.ok(insertedRecord, 'Phải gọi repository.insertCheckin');
    assert.equal(insertedRecord.storeName, 'Tạp hóa Bình An');
    assert.equal(insertedRecord.selfiePhotoUrl, 'selfie_file_id_test');
    assert.equal(insertedRecord.storePhotoUrl, 'store_file_id_test');

    assert.ok(upsertSummaryCall, 'Phải gọi repository.upsertDailySummary');
    assert.equal(upsertSummaryCall.validPointsCount, 1);
    assert.equal(upsertSummaryCall.isCompleted, false);

    // 3. Test gửi nhiều ảnh quầy kệ (1 selfie + 3 quầy kệ = 4 ảnh)
    mockBot.telegram.sendMediaGroup = async (chatId, media) => {
        telegramMediaSent = { chatId, media };
        return [
            { photo: [{ file_id: 'selfie_id' }] },
            { photo: [{ file_id: 'shelf_id_1' }] },
            { photo: [{ file_id: 'shelf_id_2' }] },
            { photo: [{ file_id: 'shelf_id_3' }] }
        ];
    };

    const reqMultiShelf = {
        body: {
            telegram_id: '8634311806',
            chat_id: '-5488818649',
            store_name: 'Siêu thị Mini Mart',
            store_address: '200 Hai Bà Trưng'
        },
        files: {
            photo_selfie: [{ path: '/tmp/s.jpg' }],
            photo_store: [
                { path: '/tmp/shelf1.jpg' },
                { path: '/tmp/shelf2.jpg' },
                { path: '/tmp/shelf3.jpg' }
            ]
        }
    };

    await capturedSubmitHandler(reqMultiShelf, createRes());
    assert.equal(resStatus, 200);
    assert.equal(resData.ok, true);
    assert.equal(insertedRecord.storeName, 'Siêu thị Mini Mart');
    assert.equal(insertedRecord.mediaUrls.length, 4, 'Phải lưu đủ 4 ảnh vào mediaUrls');
    assert.equal(insertedRecord.selfiePhotoUrl, 'selfie_id');
    assert.equal(insertedRecord.storePhotoUrl, 'shelf_id_1');
    assert.ok(telegramMediaSent.media[0].caption.includes('3 ảnh quầy kệ'), 'Nội dung caption phải nêu rõ 3 ảnh quầy kệ');
});

test('Retail Mini App Routes - History trả đúng danh sách điểm bán và tiến độ KPI theo ngày hiện tại và quá khứ', async () => {
    let capturedHistoryHandler = null;
    const mockApp = {
        get(route, handler) {
            if (route === '/api/retail-checkin/history') capturedHistoryHandler = handler;
        },
        post() {}
    };

    const mockCheckins = [
        {
            id: 'c1',
            store_name: 'Tạp hóa Lan Anh',
            store_address: '123 Nguyễn Văn Tuyết',
            checkin_time: '2026-09-05T08:06:34.000Z',
            selfie_photo_url: 'https://drive.google.com/selfie1',
            store_photo_url: 'https://drive.google.com/shelf1, https://drive.google.com/shelf2',
            media_urls: ['https://drive.google.com/selfie1', 'https://drive.google.com/shelf1', 'https://drive.google.com/shelf2'],
            is_valid: true,
            reject_reason: null
        },
        {
            id: 'c2',
            store_name: 'WinMart+',
            store_address: '456 Lê Văn Lương',
            checkin_time: '2026-09-05T09:15:00.000Z',
            selfie_photo_url: 'https://drive.google.com/selfie2',
            store_photo_url: 'https://drive.google.com/shelf3',
            media_urls: ['https://drive.google.com/selfie2', 'https://drive.google.com/shelf3'],
            is_valid: true,
            reject_reason: null
        }
    ];

    let queryParamsReceived = null;
    const mockRepo = {
        async findEmployeeByTelegramId(id) {
            if (id === '12345') {
                return { id: 'emp_1', full_name: 'Nguyễn Văn Thị Trường', role: 'Nhân viên thị trường' };
            }
            return null;
        },
        async findGroupByTelegramId(gid) {
            return { id: 'grp_1', daily_kpi_target: '15' };
        },
        async findTodayCheckins(empId, dateStr, grpId) {
            queryParamsReceived = { empId, dateStr, grpId };
            if (dateStr === '2026-09-05') {
                return mockCheckins;
            }
            return []; // Ngày khác không có
        },
        async findDailySummary(empId, dateStr, grpId) {
            if (dateStr === '2026-09-05') {
                return { is_completed: false, status: 'INCOMPLETE' };
            }
            return null;
        }
    };

    registerRetailMiniappRoutes({
        botApp: mockApp,
        bot: {},
        repository: mockRepo,
        sheetSync: {},
        moment,
        crypto: null,
        fs: null,
        retailUploadDir: '/tmp'
    });

    let resStatus = 200;
    let resData = null;
    const createRes = () => ({
        status(code) { resStatus = code; return this; },
        json(data) { resData = data; return this; }
    });

    // 1. Kiểm tra ngày 2026-09-05 có 2 điểm bán
    const reqPast = {
        query: {
            telegram_id: '12345',
            chat_id: '-1004434178722',
            date: '2026-09-05'
        }
    };

    await capturedHistoryHandler(reqPast, createRes());
    assert.equal(resStatus, 200);
    assert.equal(resData.ok, true);
    assert.equal(resData.date, '2026-09-05');
    assert.equal(resData.displayDate, '05/09/2026');
    assert.equal(resData.summary.validCount, 2);
    assert.equal(resData.summary.target, 15);
    assert.equal(resData.summary.remaining, 13);
    assert.equal(resData.summary.isCompleted, false);
    assert.equal(resData.checkins.length, 2);
    assert.equal(resData.checkins[0].storeName, 'Tạp hóa Lan Anh');
    assert.equal(resData.checkins[0].storePhotos.length, 2, 'Phải bóc tách được 2 ảnh quầy kệ');
    assert.equal(resData.checkins[1].storeName, 'WinMart+');

    // 2. Kiểm tra ngày không có dữ liệu
    const reqEmpty = {
        query: {
            telegram_id: '12345',
            chat_id: '-1004434178722',
            date: '2026-09-01'
        }
    };

    await capturedHistoryHandler(reqEmpty, createRes());
    assert.equal(resStatus, 200);
    assert.equal(resData.ok, true);
    assert.equal(resData.summary.validCount, 0);
    assert.equal(resData.checkins.length, 0);
});

test('Retail Mini App Routes - Submit tiếp nhận toạ độ GPS và gửi sang Telegram / Sheet / DB', async () => {
    let capturedSubmitHandler = null;
    const mockApp = {
        get() {},
        post(route, ...handlers) {
            if (route === '/api/retail-checkin/submit') {
                capturedSubmitHandler = handlers[handlers.length - 1];
            }
        }
    };

    let sentTelegramCaption = null;
    let savedDbCheckin = null;
    let syncedSheetCheckin = null;

    const mockBot = {
        telegram: {
            sendMessage: async (chatId, text) => {
                sentTelegramCaption = text;
            },
            sendMediaGroup: async (chatId, media) => {
                sentTelegramCaption = media[0]?.caption;
            }
        }
    };

    const mockWorkMoment = (inp) => {
        if (!inp) {
            return moment('2026-09-08T10:00:00+07:00');
        }
        return moment(inp);
    };

    const mockRepo = {
        async findEmployeeByTelegramId() {
            return { id: 10, full_name: 'Nguyễn Văn A', role: 'retail_checkin' };
        },
        async findGroupByTelegramId(id) {
            return { id: 5, telegram_group_id: id, group_name: 'TEST GROUP' };
        },
        async findLastCheckin() {
            return null;
        },
        async findTodayCheckins() {
            return [];
        },
        async insertCheckin(data) {
            savedDbCheckin = data;
            return 100;
        },
        async upsertDailySummary(data) {
            return 200;
        }
    };

    const mockSheetSync = {
        syncCheckin: async (groupId, data) => {
            syncedSheetCheckin = data;
        }
    };

    const testTempDir = path.resolve(currentDir, '../../../tmp_test_gps_miniapp');
    if (!fs.existsSync(testTempDir)) fs.mkdirSync(testTempDir, { recursive: true });
    const dummyPhoto = path.join(testTempDir, 'selfie.jpg');
    fs.writeFileSync(dummyPhoto, 'dummy image data');

    registerRetailMiniappRoutes({
        botApp: mockApp,
        bot: mockBot,
        repository: mockRepo,
        sheetSync: mockSheetSync,
        moment: mockWorkMoment,
        crypto: { randomUUID: () => 'uuid-123' },
        fs,
        retailUploadDir: testTempDir
    });

    const mockReq = {
        body: {
            telegram_id: '123456',
            chat_id: '-100999',
            store_name: 'Tạp Hóa Phương Nam',
            store_address: '456 Cầu Giấy',
            latitude: '21.033333',
            longitude: '105.783333',
            location_accuracy: '15'
        },
        files: {
            photo_selfie: [{ path: dummyPhoto, originalname: 'selfie.jpg' }]
        }
    };

    let resJson = null;
    const mockRes = {
        status() { return this; },
        json(data) { resJson = data; }
    };

    await capturedSubmitHandler(mockReq, mockRes);

    try { if (fs.existsSync(dummyPhoto)) fs.unlinkSync(dummyPhoto); } catch (_) {}
    try { if (fs.existsSync(testTempDir)) fs.rmdirSync(testTempDir); } catch (_) {}

    assert.strictEqual(resJson?.ok, true, 'Submit phải thành công');
    assert.strictEqual(savedDbCheckin?.latitude, 21.033333, 'Phải lưu latitude vào DB');
    assert.strictEqual(savedDbCheckin?.longitude, 105.783333, 'Phải lưu longitude vào DB');
    assert.strictEqual(savedDbCheckin?.locationAccuracy, 15, 'Phải lưu locationAccuracy vào DB');
    assert.ok(savedDbCheckin?.googleMapsUrl.includes('21.033333,105.783333'), 'Phải tạo Google Maps URL trong DB');

    assert.strictEqual(syncedSheetCheckin?.latitude, 21.033333, 'Phải đồng bộ latitude sang Google Sheets');
    assert.ok(sentTelegramCaption.includes('Định vị GPS:'), 'Tin nhắn Telegram phải kèm thông tin GPS');
    assert.ok(sentTelegramCaption.includes('https://maps.google.com/?q=21.033333,105.783333'), 'Tin nhắn Telegram phải kèm link Google Maps');
});



