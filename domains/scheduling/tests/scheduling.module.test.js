import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerSchedulingModule } from '../index.js';
import * as domainRules from '../domain/makeup-rules.js';
import {
    isValidSessions,
    parseRevenue,
    findMissingTourFields,
    groupIdFromStartParam,
    isRealGroupId
} from '../domain/appointment-rules.js';
import {
    buildDueReminder,
    buildArrivedMessage,
    buildPhotoDebtReminder,
    buildPhotoDebtSummary,
    parseAppointmentReplyReference,
    normalizeAppointmentIdentityText,
    arrivalKeyboard,
    cancelReasonKeyboard
} from '../domain/appointment-messages.js';
import { createBookAppointmentService } from '../application/book-appointment.js';
import { createConfirmArrivalService, CONFIRM_RESULT } from '../application/confirm-arrival.js';

const DOMAIN_DIR = fileURLToPath(new URL('../', import.meta.url));

function createHarness() {
    const routes = [];
    const actions = [];
    const crons = [];
    const photoHandlers = [];
    let queryCount = 0;

    const moduleApi = registerSchedulingModule({
        botApp: {
            get(routePath, ...handlers) { routes.push({ method: 'GET', path: routePath, handlers }); },
            post(routePath, ...handlers) { routes.push({ method: 'POST', path: routePath, handlers }); },
            put(routePath, ...handlers) { routes.push({ method: 'PUT', path: routePath, handlers }); }
        },
        bot: {},
        cron: { schedule(expression, handler) { crons.push({ expression, handler }); return { stop() {} }; } },
        sendMessageToRoleGroup: async () => ({}),
        getGroupRole: async () => 'report_tour',
        schedulePagePath: '/public/schedule.html',
        kpiComposer: {
            action(pattern, handler) { actions.push({ pattern: pattern.toString(), handler }); },
            on(event, handler) { photoHandlers.push({ event, handler }); }
        },
        getCustomerDocForGroup: async () => null,
        pool: {
            async query() {
                queryCount += 1;
                throw new Error('Không được truy vấn database lúc đăng ký module');
            },
            async connect() { throw new Error('Không được mở kết nối lúc đăng ký module'); }
        },
        authenticateTelegramMiniApp: (req, res, next) => next(),
        checkPayloadLimit: limit => { checkPayloadLimit.lastLimit = limit; return (req, res, next) => next(); },
        isValidImage: () => true,
        getImageExtension: () => '.jpg',
        escapeHtml: value => String(value),
        sendPhotoToRoleGroup: async () => ({}),
        fs: {},
        path,
        moment: () => ({ format: () => '2026-01-01' }),
        uploadDir: '/tmp/uploads',
        publicBaseUrl: 'https://example.test'
    });

    return { routes, actions, crons, queryCount, moduleApi, photoHandlers };
}
function checkPayloadLimit() {}

test('module lịch khách đăng ký đúng 12 endpoint và không chạm database lúc khởi động', () => {
    const harness = createHarness();

    assert.deepEqual(
        harness.routes.map(route => `${route.method} ${route.path}`),
        [
            // Báo bù — phải đứng TRƯỚC '/api/schedules/:id'.
            'GET /api/schedules/incomplete',
            'POST /api/schedules/makeup',
            'GET /api/schedules/makeup/history',
            // Đặt lịch
            'GET /api/schedules',
            'GET /api/schedules/search',
            'POST /api/schedules/add',
            'GET /api/schedules/:id',
            'PUT /api/schedules/update',
            'POST /api/schedules/edit',
            'POST /api/schedules/cancel',
            // Nợ ảnh
            'GET /api/photo-debts',
            'POST /api/upload-proof'
        ]
    );
    assert.equal(harness.queryCount, 0);
    assert.equal(Object.isFrozen(harness.moduleApi), true);
});

test("mọi route cụ thể của /api/schedules đều đứng trước ':id'", () => {
    // ':id' là ký tự đại diện nên nó nuốt mọi đường dẫn một đoạn. Đây là lỗi đã
    // xảy ra thật với '/api/schedules/incomplete'.
    const harness = createHarness();
    const paths = harness.routes.map(route => route.path);
    const wildcardAt = paths.indexOf('/api/schedules/:id');

    assert.ok(wildcardAt > 0, "không tìm thấy route ':id'");
    for (const specific of ['/api/schedules/incomplete', '/api/schedules/search']) {
        assert.ok(paths.indexOf(specific) < wildcardAt, `${specific} phải đăng ký trước ':id'`);
    }
});

test('module đăng ký đúng 6 nút, giữ nguyên callback_data cũ', () => {
    // Tin nhắn CŨ trong nhóm vẫn mang nút với đúng chuỗi này — đổi là các tin đó
    // bấm không ăn nữa.
    const harness = createHarness();
    assert.deepEqual(
        harness.actions.map(action => action.pattern),
        [
            // Báo bù dùng (.+) vì mã yêu cầu là uuid, không phải số.
            '/^makeup_app_(.+)$/',
            '/^makeup_rej_(.+)$/',
            '/^arr_(\\d+)$/',
            '/^can_(\\d+)$/',
            '/^cr_back_(\\d+)$/',
            '/^cr_(bom|ban|tien|khacspa|app)_(\\d+)$/'
        ]
    );
});

test('5 cron lịch khách giữ nguyên giờ chạy', () => {
    const harness = createHarness();
    assert.deepEqual(
        harness.crons.map(job => job.expression),
        ['2 20 * * *', '0 22 * * *', '0 0 * * *', '* * * * *', '*/5 * * * *']
    );
});

test('module đăng ký handler reply ảnh trực tiếp trên Telegram', () => {
    const harness = createHarness();
    assert.deepEqual(harness.photoHandlers.map(h => h.event), ['photo']);
});

test('ai được duyệt: chính chủ, Quản lý nhóm, hoặc Admin', () => {
    // Quy tắc do chủ hệ thống đặt 14/08/2026: người đặt lịch tự duyệt được,
    // quản lý/admin duyệt hộ. Trước đó hệ thống CẤM tự duyệt.
    const { checkReviewPermission } = domainRules;
    const request = { status: 'PENDING', telegram_id: '111', telegram_group_id: '-1' };

    const cases = [
        ['chính chủ tự duyệt', '111', false, false, true],
        ['Quản lý duyệt hộ', '222', false, true, true],
        ['Admin duyệt hộ', '333', true, false, true],
        ['người ngoài', '444', false, false, false]
    ];
    for (const [label, clickerId, isAdmin, isManager, expected] of cases) {
        const verdict = checkReviewPermission({ request, clickerId, isAdmin, isManager });
        assert.equal(verdict.ok, expected, label);
    }

    // Yêu cầu đã xử lý rồi thì không ai bấm lại được, kể cả chính chủ.
    assert.equal(
        checkReviewPermission({
            request: { ...request, status: 'APPROVED' },
            clickerId: '111', isAdmin: true, isManager: true
        }).ok,
        false,
        'yêu cầu đã xử lý phải bị chặn'
    );
});

test('vai trò Quản lý phải đúng trong nhóm của yêu cầu', () => {
    // Quản lý nhóm khác không được duyệt hộ nhóm này.
    const repo = fs.readFileSync(
        path.join(DOMAIN_DIR, 'infrastructure', 'postgres', 'makeup-repository.js'), 'utf8');
    assert.match(repo, /e\.role = 'Quản lý'/);
    assert.match(repo, /m\.status = 'ACTIVE'/);
    assert.match(repo, /m\.telegram_group_id = \$2/);
});

test('tự duyệt phải để lại dấu vết trên tin nhắn', () => {
    // Bỏ chốt tiền kiểm thì dấu này là cách duy nhất hậu kiểm xem yêu cầu đã qua
    // người thứ hai hay chưa.
    const service = fs.readFileSync(
        path.join(DOMAIN_DIR, 'application', 'review-makeup-request.js'), 'utf8');
    assert.match(service, /isSelfReview: request\.telegram_id === clicker\.id/);

    const actions = fs.readFileSync(
        path.join(DOMAIN_DIR, 'interfaces', 'telegram', 'register-makeup-actions.js'), 'utf8');
    assert.match(actions, /isSelfReview \? ' <i>\(tự duyệt\)<\/i>' : ''/);
});

test('giới hạn payload giữ đúng 14MB như bản cũ', () => {
    // Ảnh base64 phình ~33% so với ảnh gốc; hạ mức này là chặn nhầm ảnh hợp lệ.
    const rules = fs.readFileSync(path.join(DOMAIN_DIR, 'domain', 'makeup-rules.js'), 'utf8');
    assert.match(rules, /MAX_PAYLOAD_BYTES = 14 \* 1024 \* 1024/);
    assert.match(rules, /MAX_PROOF_BYTES = 10 \* 1024 \* 1024/);
    assert.match(rules, /MAKEUP_WINDOW_HOURS = 48/);
});

test('kpi_features.js chỉ lắp ghép, không còn khai báo route báo bù trực tiếp', () => {
    const source = fs.readFileSync(
        fileURLToPath(new URL('../../../apps/bot/kpi_features.js', import.meta.url)), 'utf8');

    assert.match(source, /registerSchedulingModule\(\{/);
    assert.doesNotMatch(source, /botApp\.(get|post)\(['"]\/api\/schedules\/makeup/);
    assert.doesNotMatch(source, /botApp\.get\(['"]\/api\/schedules\/incomplete/);
    // Handler duyệt/từ chối cũng đã rời khỏi file này.
    assert.doesNotMatch(source, /kpiComposer\.action\(\/\^makeup_/);

    // SQL của việc TẠO yêu cầu phải rời khỏi file này.
    assert.doesNotMatch(source, /INSERT INTO tour_makeup_requests/);
    assert.doesNotMatch(source, /status = ANY\(\$5::text\[\]\)/);

    // Đặt lịch cũng đã rời khỏi file này.
    assert.doesNotMatch(source, /botApp\.(get|post|put)\(['"]\/api\/schedules['"]/);
    assert.doesNotMatch(source, /botApp\.post\(['"]\/api\/schedules\/(add|edit|cancel)/);
    assert.doesNotMatch(source, /botApp\.get\(['"]\/api\/schedules\/:id/);
    // GET /schedule CỐ Ý ở lại: nó phục vụ trang ĐĂNG KÝ LỊCH TUẦN của role chấm
    // công (gọi /api/timekeep/schedule/*), không phải lịch khách tour.
    assert.match(source, /botApp\.get\('\/schedule'/);
    // INSERT của việc ĐẶT LỊCH (có session_type + revenue) phải rời khỏi đây.
    // Lưu ý: kpi_features.js VẪN còn một INSERT customer_appointments khác, ngắn
    // hơn, nằm trong /api/bot/submit-report — đó là role `report` tự sinh lịch từ
    // nội dung báo cáo, không phải chức năng đặt lịch của role tour.
    assert.doesNotMatch(source, /INSERT INTO customer_appointments[\s\S]{0,200}session_type, revenue/);
    assert.doesNotMatch(source, /kpiComposer\.action\(\/\^(arr|can|cr)_/);
    // 4 cron lịch khách đã sang module.
    assert.doesNotMatch(source, /BÁO ĐỘNG LỊCH KHÁCH HÀNG ĐẾN GIỜ/);
    assert.doesNotMatch(source, /TỔNG KẾT LỊCH KHÁCH HÀNG HÔM NAY/);
    assert.doesNotMatch(source, /CHƯA ĐỦ CÔNG TOUR/);

    // Nợ ảnh + đồng bộ Sheet đã rời khỏi file này — domain không còn "còn nợ" nào.
    assert.doesNotMatch(source, /syncMakeupToGoogleSheetWithRetry/, 'đồng bộ Sheet đã rời file này');
    assert.doesNotMatch(source, /botApp\.get\('\/api\/photo-debts'/, 'nợ ảnh đã rời file này');
    assert.doesNotMatch(source, /botApp\.post\('\/api\/upload-proof'/, 'tải ảnh đã rời file này');
    assert.doesNotMatch(source, /kpiComposer\.on\('photo'/, 'reply ảnh lịch khách đã rời file này');
    assert.doesNotMatch(source, /function getCustomerSheetTarget/, 'hàm đồng bộ Sheet đã rời file này');
    assert.doesNotMatch(source, /function writeToGoogleSheets/, 'hàm đồng bộ Sheet đã rời file này');
});

test('module phải đăng ký TRƯỚC mọi route /api/schedules còn lại trong kpi_features.js', () => {
    // Express khớp route theo thứ tự đăng ký. ':id' trong module dùng ký tự đại
    // diện nên nó nuốt luôn mọi '/api/schedules/<một đoạn>'. Lỗi này từng tồn tại
    // thật với '/api/schedules/incomplete', đừng để tái diễn.
    const source = fs.readFileSync(
        fileURLToPath(new URL('../../../apps/bot/kpi_features.js', import.meta.url)), 'utf8');

    const moduleAt = source.indexOf('registerSchedulingModule({');
    assert.ok(moduleAt > 0, 'không tìm thấy lời gọi module');

    for (const match of source.matchAll(/botApp\.(get|post|put|delete)\('(\/api\/schedules[^']*)'/g)) {
        assert.fail(`${match[2]} phải nằm trong module, không được khai báo ở kpi_features.js`);
    }
});

/* ---------- Nghiệp vụ đặt lịch ---------- */

test('số buổi làm chỉ nhận X/Y hoặc X/Tái khám', () => {
    // Gõ sai định dạng thì tổng hợp công tour đếm sai buổi.
    for (const value of ['2/10', '1/Tái khám', '1/tai kham', '0', '', null, undefined]) {
        assert.equal(isValidSessions(value), true, `phải chấp nhận: ${value}`);
    }
    for (const value of ['2', 'abc', '2/', '/10', 'x/10', '1/2/3', '1/abc']) {
        assert.equal(isValidSessions(value), false, `phải từ chối: ${value}`);
    }
});

test('quy đổi tiền tự do về số nguyên', () => {
    assert.equal(parseRevenue('500,000đ'), 500000);
    assert.equal(parseRevenue('1.500.000'), 1500000);
    assert.equal(parseRevenue('abc'), 0);
    assert.equal(parseRevenue(''), 0);
    assert.equal(parseRevenue(null), 0);
});

test('điều kiện đủ công tour', () => {
    const full = {
        customer_name: 'A', phone: '09', service: 'S', sessions: '1/10',
        revenue: '500000', session_type: 'Bán',
        status: 'ARRIVED', is_photo_debt: false, proof_image: 'https://x/y.jpg'
    };
    assert.deepEqual(findMissingTourFields(full), []);

    // Khách đã đến mà còn nợ ảnh thì chưa đủ công.
    assert.deepEqual(findMissingTourFields({ ...full, is_photo_debt: true }), ['Ảnh chứng thực']);
    assert.deepEqual(findMissingTourFields({ ...full, proof_image: null }), ['Ảnh chứng thực']);

    // Còn ACTIVE tới 00:00 = nhân viên quên xác nhận, không tự đoán hộ.
    assert.deepEqual(findMissingTourFields({ ...full, status: 'ACTIVE' }),
        ['Chưa xác nhận khách đến hoặc hủy lịch']);

    assert.deepEqual(
        findMissingTourFields({ ...full, customer_name: '  ', revenue: '' }),
        ['Tên khách', 'Thu tiền']
    );
});

test('nhóm đặt lịch đọc từ start_param, không tin groupId client gửi lên', () => {
    assert.equal(groupIdFromStartParam('schedule_-1001234'), '-1001234');
    assert.equal(groupIdFromStartParam('scheduleclient_-1001234'), '-1001234');
    assert.equal(groupIdFromStartParam('whexport_-1001234'), '');
    assert.equal(groupIdFromStartParam(''), '');
    assert.equal(isRealGroupId('MINI_APP'), false, 'MINI_APP là giá trị giữ chỗ, không phải nhóm');
    assert.equal(isRealGroupId(''), false);
    assert.equal(isRealGroupId('-1001234'), true);
});

test('đặt lịch trùng khung giờ dưới 1 tiếng bị chặn, trừ lịch đi luôn', async () => {
    const overlap = {
        employee_name: 'Lan', customer_name: 'Khách A',
        appointment_time: '2026-08-14T09:00:00Z'
    };
    let inserted = 0;
    const book = createBookAppointmentService({
        repository: {
            SCHEDULE_NOTIFY_ROLES: ['report', 'report_tour'],
            async findOverlap() { return overlap; },
            async findActiveByPhoneToday() { return null; },
            async findEmployee() { return { full_name: 'Lan', employee_code: 'NV1' }; },
            async insert() { inserted += 1; return 7; },
            async findUrgentTargetGroups() { return []; }
        },
        notifier: { async send() {} },
        getGroupRole: async () => 'report_tour'
    });

    const initData = 'user=' + encodeURIComponent(JSON.stringify({ id: 111, first_name: 'Lan' }))
        + '&start_param=schedule_-1001234';
    const form = { appointment_time: '2026-08-14T09:30:00Z', customer_name: 'B', phone: '09' };

    const blocked = await book({ initData, requestedGroupId: '-1001234', form });
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /Vui lòng chọn giờ cách ít nhất 1 tiếng/);
    assert.equal(inserted, 0, 'lịch trùng không được ghi vào database');

    // Khách đi luôn: khách đã ở đó rồi nên bỏ qua kiểm trùng KHUNG GIỜ.
    const urgent = await book({ initData, requestedGroupId: '-1001234', form: { ...form, is_urgent: true } });
    assert.equal(urgent.ok, true);
    assert.equal(inserted, 1);
});

test('lịch đi luôn vẫn bị chặn nếu CÙNG KHÁCH đã có lịch ACTIVE trong ngày', async () => {
    const existing = {
        id: 42, employee_name: 'Lan', appointment_time: '2026-08-14T09:00:00Z'
    };
    let inserted = 0;
    const book = createBookAppointmentService({
        repository: {
            SCHEDULE_NOTIFY_ROLES: ['report', 'report_tour'],
            async findOverlap() { throw new Error('không được gọi khi is_urgent = true'); },
            async findActiveByPhoneToday() { return existing; },
            async findEmployee() { return { full_name: 'Lan', employee_code: 'NV1' }; },
            async insert() { inserted += 1; return 99; },
            async findUrgentTargetGroups() { return []; }
        },
        notifier: { async send() {} },
        getGroupRole: async () => 'report_tour'
    });

    const initData = 'user=' + encodeURIComponent(JSON.stringify({ id: 111, first_name: 'Lan' }))
        + '&start_param=schedule_-1001234';
    const form = {
        appointment_time: '2026-08-14T14:00:00Z', customer_name: 'Cô Đằm', phone: '55222', is_urgent: true
    };

    const outcome = await book({ initData, requestedGroupId: '-1001234', form });
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /đã có lịch #42/);
    assert.equal(inserted, 0, 'không được tạo thêm lịch trùng cho cùng khách');
});

test('không đặt được lịch chéo nhóm', async () => {
    const book = createBookAppointmentService({
        repository: { SCHEDULE_NOTIFY_ROLES: [], async findOverlap() { return null; } },
        notifier: {}, getGroupRole: async () => 'report_tour'
    });
    const initData = 'user=' + encodeURIComponent(JSON.stringify({ id: 111 }))
        + '&start_param=schedule_-100AAA';

    const outcome = await book({ initData, requestedGroupId: '-100BBB', form: {} });
    assert.equal(outcome.status, 403);
});

test('chỉ người đặt lịch được bấm Đã đến / Hủy', async () => {
    // Đây là căn cứ tính công tour của chính họ, không cho người khác xác nhận hộ.
    let arrived = 0;
    const confirm = createConfirmArrivalService({
        repository: {
            async findOwnerOf(id) { return id === '404' ? null : { telegram_id: '111' }; },
            async markArrived() { arrived += 1; }
        }
    });

    assert.equal((await confirm.markArrived({ id: '404', clickerId: 111 })).result, CONFIRM_RESULT.NOT_FOUND);
    assert.equal((await confirm.markArrived({ id: '7', clickerId: 222 })).result, CONFIRM_RESULT.NOT_OWNER);
    assert.equal(arrived, 0);

    assert.equal((await confirm.markArrived({ id: '7', clickerId: 111 })).result, CONFIRM_RESULT.OK);
    assert.equal(arrived, 1);

    // Lý do "khác" phải gõ trong Mini App, không đổi trạng thái ở đây.
    assert.equal((await confirm.cancelWithReason({ id: '7', type: 'app' })).needsMiniApp, true);
});

test('tin nhắn giữ nguyên nút cũ và mã lịch', () => {
    const appointment = {
        id: 7, appointment_time: '2026-08-14T02:00:00Z', customer_name: 'A', phone: '09',
        service: 'S', sessions: '1/10', employee_name: 'Lan'
    };
    assert.match(buildDueReminder(appointment), /BÁO ĐỘNG LỊCH KHÁCH HÀNG ĐẾN GIỜ/);
    assert.match(buildDueReminder(appointment), /🆔 Mã Lịch: #7/);
    assert.match(buildArrivedMessage('tin cũ', 7), /🆔 Mã Lịch: #7/);
    assert.match(buildArrivedMessage('tin cũ', 7), /NỢ 1 ẢNH BẰNG CHỨNG/);

    assert.deepEqual(arrivalKeyboard(7).inline_keyboard[0].map(b => b.callback_data), ['arr_7', 'can_7']);
    assert.deepEqual(arrivalKeyboard(7, { withArrived: false }).inline_keyboard[0].map(b => b.callback_data), ['can_7']);
    assert.deepEqual(
        cancelReasonKeyboard(7).inline_keyboard.map(row => row[0].callback_data),
        ['cr_bom_7', 'cr_ban_7', 'cr_tien_7', 'cr_khacspa_7', 'cr_app_7', 'cr_back_7']
    );
});

test('nhóm report được nhắc lịch thiếu sau 30 phút và cuối ngày, không dùng công tour', () => {
    const item = {
        id: 7,
        appointment_time: '2026-08-14T02:00:00Z',
        customer_name: 'Khách A',
        employee_name: 'Lan',
        status: 'ACTIVE',
        proof_image: null,
        is_photo_debt: false
    };
    const reminder = buildPhotoDebtReminder(item);
    const summary = buildPhotoDebtSummary([item], '14/08/2026');

    assert.match(reminder, /LỊCH KHÁCH CHƯA HOÀN TẤT/);
    assert.match(reminder, /Hoàn Tất Lịch/);
    assert.match(summary, /LỊCH CHƯA HOÀN TẤT ẢNH/);
    assert.doesNotMatch(`${reminder}\n${summary}`, /công tour|doanh thu/i);

    const repository = fs.readFileSync(
        path.join(DOMAIN_DIR, 'infrastructure', 'postgres', 'completion-repository.js'), 'utf8');
    assert.match(repository, /completion_reminded_at IS NULL/);
    assert.match(repository, /INTERVAL '30 minutes'/);
    assert.match(repository, /markCompletionReminded/);
    assert.match(repository, /g\.bot_role = 'report'/);
});

test('reply ảnh đọc mã lịch mới và vẫn nhận diện được tin nhắn cũ', () => {
    assert.deepEqual(parseAppointmentReplyReference(
        '⏰ Giờ hẹn: 09:30\n👤 Khách hàng: Vũ thị quyên (SĐT: 02468)\n🆔 Mã Lịch: #543'
    ), {
        id: '543',
        customerName: 'Vũ thị quyên',
        phone: '02468',
        appointmentTime: '09:30'
    });
    assert.deepEqual(parseAppointmentReplyReference(
        '⏰ Giờ hẹn: 09:30\n👤 Khách hàng: Vũ thị quyên (SĐT: 02468)'
    ), {
        id: null,
        customerName: 'Vũ thị quyên',
        phone: '02468',
        appointmentTime: '09:30'
    });
    assert.equal(
        normalizeAppointmentIdentityText('Vũ thị Quyên'),
        normalizeAppointmentIdentityText('Vũ thị Quyên')
    );
});

test('reply ảnh lịch khách nhận cả ACTIVE và luôn giới hạn đúng nhóm', () => {
    const handlerSource = fs.readFileSync(
        path.join(DOMAIN_DIR, 'interfaces', 'telegram', 'register-photo-reply-handler.js'), 'utf8');
    assert.match(handlerSource, /groupRole === 'report'/);
    assert.match(handlerSource, /diff\(moment\(apt\.appointment_time\), 'hours', true\) > 48/);
    assert.match(handlerSource, /canOverride = isAdmin \|\| await repository\.isManagerOfGroup/);

    const repoSource = fs.readFileSync(
        path.join(DOMAIN_DIR, 'infrastructure', 'postgres', 'proof-repository.js'), 'utf8');
    assert.match(repoSource, /status IN \('ACTIVE', 'ARRIVED'\)/);
    assert.match(repoSource, /SET status = 'ARRIVED', is_photo_debt = FALSE, proof_image = \$1/);
    assert.match(repoSource, /TO_CHAR\(appointment_time, 'HH24:MI'\)/);
});

/* ---------- Luật kiến trúc, nhân bản từ domains/warehouse ---------- */

function domainFiles() {
    return fs.readdirSync(DOMAIN_DIR, { recursive: true })
        .map(entry => String(entry).split(path.sep).join('/'))
        .filter(entry => entry.endsWith('.js') && !entry.startsWith('tests/'));
}

const readFile = relative => fs.readFileSync(path.join(DOMAIN_DIR, relative), 'utf8');
const stripComments = source =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('tầng domain không phụ thuộc express, pg, telegraf hay Google API', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        const imports = [...readFile(file).matchAll(/from\s+'([^']+)'/g)].map(match => match[1]);
        for (const specifier of imports) {
            assert.ok(
                specifier.startsWith('.'),
                `${file} không được import thư viện ngoài: ${specifier}`
            );
        }
    }
});

test('chỉ tầng infrastructure được viết SQL', () => {
    const SQL = /\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/;
    for (const file of domainFiles()) {
        if (file.startsWith('infrastructure/')) continue;
        assert.ok(
            !SQL.test(stripComments(readFile(file))),
            `${file} chứa SQL — mọi truy vấn phải nằm trong infrastructure/postgres/`
        );
    }
});

test('domain không được phụ thuộc ngược lên tầng trên', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('domain/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
            assert.ok(
                target.startsWith('domain/') || !target.includes('/'),
                `${file} không được phụ thuộc tầng trên: ${target}`
            );
        }
    }
});

test('application không được biết tới interfaces', () => {
    for (const file of domainFiles()) {
        if (!file.startsWith('application/')) continue;
        for (const match of readFile(file).matchAll(/from\s+'([^']+)'/g)) {
            assert.ok(
                !match[1].includes('interfaces/'),
                `${file} không được import interfaces: ${match[1]}`
            );
        }
    }
});

test('mọi import tương đối trong domain đều trỏ tới file có thật', () => {
    for (const file of domainFiles()) {
        for (const match of readFile(file).matchAll(/from\s+'(\.[^']+)'/g)) {
            const target = path.resolve(path.dirname(path.join(DOMAIN_DIR, file)), match[1]);
            assert.ok(fs.existsSync(target), `${file} -> ${match[1]} không tồn tại`);
        }
    }
});

test('không file nào trong domain vượt 300 dòng', () => {
    const tooLong = domainFiles()
        .map(file => ({ file, lines: readFile(file).split('\n').length }))
        .filter(entry => entry.lines > 300)
        .map(entry => `${entry.file} (${entry.lines} dòng)`);
    assert.deepEqual(tooLong, [], 'Các file sau cần được tách nhỏ');
});
