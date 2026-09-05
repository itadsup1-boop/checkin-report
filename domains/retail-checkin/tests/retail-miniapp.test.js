import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import moment from 'moment';
import { registerRetailMiniappRoutes } from '../interfaces/miniapp-api/register-retail-miniapp-routes.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(currentDir, '../../../apps/bot/public');

test('Retail Mini App - File HTML tồn tại và có đầy đủ cấu trúc UI/UX', () => {
    const htmlPath = path.join(publicDir, 'retail_checkin.html');
    assert.ok(fs.existsSync(htmlPath), 'File retail_checkin.html phải tồn tại');

    const content = fs.readFileSync(htmlPath, 'utf8');
    assert.ok(content.includes('Check-in Tuyến Điểm Bán'), 'Phải có tiêu đề Check-in Tuyến Điểm Bán');
    assert.ok(content.includes('15 điểm'), 'Phải hiển thị KPI mục tiêu 15 điểm');
    assert.ok(content.includes('storeNameInput'), 'Phải có input tên cửa hàng');
    assert.ok(content.includes('storeAddressInput'), 'Phải có input địa chỉ cửa hàng');
    assert.ok(content.includes('actionSheetOverlay'), 'Phải có modal Action Sheet chọn Camera hoặc Thư viện');
    assert.ok(content.includes('btnActionCamera'), 'Phải có nút Chụp ảnh trực tiếp');
    assert.ok(content.includes('btnActionGallery'), 'Phải có nút Chọn từ thư viện');
    assert.ok(content.includes('fileSelfieCamera'), 'Phải có input camera cho selfie');
    assert.ok(content.includes('fileStoreCamera'), 'Phải có input camera cho quầy kệ');
    assert.ok(content.includes('/api/retail-checkin/submit'), 'Phải gọi API submit');
    assert.ok(content.includes('/api/retail-checkin/bootstrap'), 'Phải gọi API bootstrap');
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
    let sheetSyncCall = null;
    let telegramMediaSent = null;

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
                checkin_time: moment().utcOffset(7).subtract(30, 'seconds').toISOString()
            };
        },
        async findTodayCheckins() {
            return [];
        },
        async insertCheckin(data) {
            insertedRecord = data;
            return { id: 100, ...data };
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
        moment,
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

    // 1. Test chặn spam (cách đây 30s)
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
    assert.equal(resStatus, 429, 'Phải trả về 429 Too Many Requests khi spam < 120s');
    assert.ok(resData.message.includes('chưa đầy 2 phút'), 'Thông báo phải cảnh báo khoảng cách 2 phút');

    // 2. Test gửi thành công khi qua 120s
    mockRepo.findLastCheckin = async () => ({
        id: 99,
        checkin_time: moment().utcOffset(7).subtract(150, 'seconds').toISOString()
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

    assert.ok(sheetSyncCall, 'Phải gọi sheetSync.syncCheckin');
    assert.equal(sheetSyncCall.data.storeName, 'Tạp hóa Bình An');
    assert.equal(sheetSyncCall.data.progressStr, '1/15');

    assert.ok(telegramMediaSent, 'Phải gửi thông báo ảnh vào nhóm Telegram');
    assert.equal(telegramMediaSent.chatId, '-5488818649');

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

