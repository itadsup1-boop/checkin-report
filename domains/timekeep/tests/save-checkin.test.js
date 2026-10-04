import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { createSaveCheckin } from '../application/save-checkin.js';

function createHarness({ existingCheckin = null, policy = null, userSchedule = null, leaveRequest = null, customMoment = moment } = {}) {
    const insertedCheckins = [];
    const recordedCheckouts = [];
    const clearedPenalties = [];
    const sentVideos = [];
    const sentPhotos = [];
    let synced = false;

    const checkinRepository = {
        findCheckInOfDay: async () => existingCheckin,
        insertCheckIn: async data => insertedCheckins.push(data),
        recordCheckOut: async data => recordedCheckouts.push(data),
        clearCheckoutPenalty: async data => clearedPenalties.push(data),
        findGroupPolicy: async () => policy || {
            attendance_policy: 'CLINIC',
            checkout_min_time: '18:30:00'
        },
        insertLatePenalty: async () => {},
        findUserScheduleOfDay: async () => userSchedule,
        findApprovedLateLeaveRequest: async () => leaveRequest
    };

    const scheduleRepository = {
        findGroupByTelegramGroupId: async () => ({ id: 10, telegram_group_id: '-1001' }),
        findTelegramGroupId: async () => '-1001'
    };

    const findEmployeeContext = async (telegramId) => {
        if (telegramId === 'user1') {
            return { id: 1, full_name: 'Nguyễn Văn A', role: 'Nhân viên', group_id: 10 };
        }
        return null;
    };

    const isSystemAdmin = () => false;
    const sendVideoToRoleGroup = async (bot, groupId, role, media, options, tag) => {
        sentVideos.push({ groupId, role, media, options, tag });
    };
    const sendPhotoToRoleGroup = async (bot, groupId, role, photo, options, tag) => {
        sentPhotos.push({ groupId, role, photo, options, tag });
    };
    const syncSheets = async () => { synced = true; };

    const { saveCheckin } = createSaveCheckin({
        checkinRepository,
        scheduleRepository,
        findEmployeeContext,
        isSystemAdmin,
        moment: customMoment,
        fs: { mkdirSync: () => {}, writeFileSync: () => {} },
        path: {
            extname: (file) => {
                const match = String(file).match(/\.[0-9a-z]+$/i);
                return match ? match[0] : '';
            },
            join: (...args) => args.join('/')
        },
        exec: (cmd, cb) => cb(null),
        bot: {},
        sendVideoToRoleGroup,
        sendPhotoToRoleGroup,
        uploadDir: '/tmp',
        syncSheets
    });

    return {
        saveCheckin,
        insertedCheckins,
        recordedCheckouts,
        clearedPenalties,
        sentVideos,
        sentPhotos,
        getSynced: () => synced
    };
}

test('saveCheckin - Lần 1 nộp video trong ngày: Ghi nhận Check-in thành công', async () => {
    const h = createHarness({ existingCheckin: null });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/test.mp4', filename: 'test.mp4' }
    };

    const result = await h.saveCheckin(req);

    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, false);
    assert.match(result.message, /Check-in/);
    assert.equal(h.insertedCheckins.length, 1);
    assert.equal(h.recordedCheckouts.length, 0);
    assert.equal(h.getSynced(), true);

    // Chạy background task gửi video
    await result.runBackgroundTask();
    assert.equal(h.sentVideos.length, 1);
    assert.equal(h.sentVideos[0].tag, 'checkin_video');
    assert.match(h.sentVideos[0].options.caption, /BÁO CÁO ĐIỂM DANH/);
});

test('saveCheckin - Lần 2 nộp video trong ngày: Tự động ghi nhận Check-out thành công', async () => {
    const existingCheckin = {
        id: 100,
        user_id: 1,
        date: moment().utcOffset(7).format('YYYY-MM-DD'),
        check_in_time: '2026-09-28 08:15:00'
    };

    const h = createHarness({ existingCheckin });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/test2.mp4', filename: 'test2.mp4' }
    };

    const result = await h.saveCheckin(req);

    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, true);
    assert.equal(result.message, 'Check-out thành công!');
    assert.equal(h.insertedCheckins.length, 0);
    assert.equal(h.recordedCheckouts.length, 1);
    assert.equal(h.recordedCheckouts[0].userId, 1);
    assert.equal(h.recordedCheckouts[0].checkoutStatus, 'HOAN_THANH');
    assert.equal(h.recordedCheckouts[0].penaltyAmount, 0);
    assert.equal(h.clearedPenalties.length, 1);
    assert.equal(h.getSynced(), true);

    // Chạy background task gửi video
    await result.runBackgroundTask();
    assert.equal(h.sentVideos.length, 1);
    assert.equal(h.sentVideos[0].tag, 'checkout_video');
    assert.match(h.sentVideos[0].options.caption, /BÁO CÁO CHECK-OUT/);
});

test('saveCheckin - Nộp ảnh lần 1 (Check-in bằng ảnh): Ghi nhận thành công và gửi ảnh vào nhóm', async () => {
    const h = createHarness({ existingCheckin: null });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/selfie.jpg', filename: 'selfie.jpg' }
    };

    const result = await h.saveCheckin(req);

    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, false);
    assert.match(result.message, /Check-in/);
    assert.equal(h.insertedCheckins.length, 1);

    await result.runBackgroundTask();
    assert.equal(h.sentPhotos.length, 1);
    assert.equal(h.sentPhotos[0].tag, 'checkin_photo');
    assert.match(h.sentPhotos[0].options.caption, /BÁO CÁO ĐIỂM DANH/);
});

test('saveCheckin - Nộp ảnh lần 2 (Check-out bằng ảnh): Ghi nhận Check-out thành công và gửi ảnh vào nhóm', async () => {
    const existingCheckin = {
        id: 101,
        user_id: 1,
        date: moment().utcOffset(7).format('YYYY-MM-DD'),
        check_in_time: '2026-09-28 08:30:00'
    };

    const h = createHarness({ existingCheckin });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/checkout_photo.png', filename: 'checkout_photo.png' }
    };

    const result = await h.saveCheckin(req);

    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, true);
    assert.equal(result.message, 'Check-out thành công!');
    assert.equal(h.recordedCheckouts.length, 1);

    await result.runBackgroundTask();
    assert.equal(h.sentPhotos.length, 1);
    assert.equal(h.sentPhotos[0].tag, 'checkout_photo');
    assert.match(h.sentPhotos[0].options.caption, /BÁO CÁO CHECK-OUT/);
});

test('saveCheckin - Lỗi khi chưa đăng ký tài khoản nhân sự', async () => {
    const h = createHarness();

    const req = {
        body: { chat_id: '-1001', telegram_id: 'unknown_user' },
        file: { path: '/tmp/test.mp4', filename: 'test.mp4' }
    };

    const result = await h.saveCheckin(req);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.match(result.message, /chưa đăng ký tài khoản/);
});

test('saveCheckin - Marketing policy: Check-in thông báo và caption đúng giờ hoặc đi muộn', async () => {
    const policy = {
        attendance_policy: 'MARKETING',
        marketing_checkin_deadline: '08:30:00',
        marketing_late_cutoff: '09:30:00',
        marketing_checkin_penalty: 50000,
        effective_start_date: '2026-01-01'
    };
    const h = createHarness({ existingCheckin: null, policy });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/checkin.jpg', filename: 'checkin.jpg' }
    };

    const result = await h.saveCheckin(req);
    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, false);
    assert.equal(h.insertedCheckins.length, 1);

    await result.runBackgroundTask();
    assert.equal(h.sentPhotos.length, 1);
    // Caption phải chứa nội dung MARKETING và ghi nhận trạng thái
    assert.match(h.sentPhotos[0].options.caption, /MARKETING/);
});

test('saveCheckin - Marketing policy: Check-out gửi caption hoàn thành theo Marketing', async () => {
    const existingCheckin = {
        id: 105,
        user_id: 1,
        date: moment().utcOffset(7).format('YYYY-MM-DD'),
        check_in_time: '2026-09-28 08:30:00'
    };
    const policy = {
        attendance_policy: 'MARKETING',
        effective_start_date: '2026-01-01'
    };
    const h = createHarness({ existingCheckin, policy });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/checkout.mp4', filename: 'checkout.mp4' }
    };

    const result = await h.saveCheckin(req);
    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, true);

    await result.runBackgroundTask();
    assert.equal(h.sentVideos.length, 1);
    assert.match(h.sentVideos[0].options.caption, /CHECK-OUT THÀNH CÔNG – MARKETING/);
});

test('saveCheckin - Nhân sự đăng ký Ca 2 (09:30): Mốc chốt chuyển thành 09:30', async () => {
    const policy = {
        attendance_policy: 'MARKETING',
        marketing_checkin_deadline: '08:30:00',
        marketing_late_cutoff: '09:30:00',
        marketing_checkin_penalty: 50000,
        effective_start_date: '2026-01-01'
    };
    const userSchedule = { shift_type: 'CA_2' };
    const h = createHarness({ existingCheckin: null, policy, userSchedule });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/checkin_ca2.jpg', filename: 'checkin_ca2.jpg' }
    };

    const result = await h.saveCheckin(req);
    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, false);
    assert.equal(h.insertedCheckins.length, 1);

    await result.runBackgroundTask();
    assert.equal(h.sentPhotos.length, 1);
    assert.match(h.sentPhotos[0].options.caption, /Ca 2 - 09:30/);
});

test('saveCheckin - Có đơn xin đi muộn đã duyệt: Mốc chốt được cộng dồn thời gian xin muộn', async () => {
    const policy = {
        attendance_policy: 'MARKETING',
        marketing_checkin_deadline: '08:30:00',
        marketing_late_cutoff: '09:30:00',
        marketing_checkin_penalty: 50000,
        effective_start_date: '2026-01-01'
    };
    const leaveRequest = {
        id: 'leave-miniapp-1',
        leave_type: 'LATE',
        status: 'APPROVED',
        late_minutes: 60
    };
    const h = createHarness({ existingCheckin: null, policy, leaveRequest });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/checkin_leave.jpg', filename: 'checkin_leave.jpg' }
    };

    const result = await h.saveCheckin(req);
    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, false);
    assert.equal(h.insertedCheckins.length, 1);

    await result.runBackgroundTask();
    assert.equal(h.sentPhotos.length, 1);
    assert.match(h.sentPhotos[0].options.caption, /Xin muộn \+60p/);
});

test('saveCheckin - Marketing policy: Thêm 5 phút ân hạn cho check-in (08:33 chấp nhận đúng giờ)', async () => {
    const policy = {
        attendance_policy: 'MARKETING',
        marketing_checkin_deadline: '08:30:00',
        marketing_late_cutoff: '09:30:00',
        marketing_checkin_penalty: 50000,
        effective_start_date: '2026-01-01'
    };
    // Mock moment at 08:33:02
    const fakeMoment = (...args) => {
        if (args.length === 0) {
            return moment('2026-09-29 08:33:02 +07:00', 'YYYY-MM-DD HH:mm:ss Z');
        }
        return moment(...args);
    };
    Object.assign(fakeMoment, moment);

    const h = createHarness({ existingCheckin: null, policy, customMoment: fakeMoment });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/checkin_0833.jpg', filename: 'checkin_0833.jpg' }
    };

    const result = await h.saveCheckin(req);
    assert.equal(result.ok, true);
    assert.equal(result.isCheckout, false);
    assert.equal(h.insertedCheckins.length, 1);
    assert.equal(h.insertedCheckins[0].workCredit, 1.0, 'Được tính đủ 1.0 công do trong 5 phút ân hạn');
    assert.equal(h.insertedCheckins[0].checkinPenaltyAmount, 0, '0đ phạt khi check-in lúc 08:33');
    assert.match(result.message, /đúng giờ/);

    await result.runBackgroundTask();
    assert.equal(h.sentPhotos.length, 1);
    assert.match(h.sentPhotos[0].options.caption, /Đúng giờ/);
});

test('saveCheckin - Marketing policy: Có đơn xin đi muộn (+30p) thì chỉ cộng 30p, không cộng thêm 5p ân hạn', async () => {
    const policy = {
        attendance_policy: 'MARKETING',
        marketing_checkin_deadline: '08:30:00',
        marketing_late_cutoff: '09:30:00',
        marketing_checkin_penalty: 50000,
        effective_start_date: '2026-01-01'
    };
    const leaveRequest = {
        id: 'leave-miniapp-30',
        leave_type: 'LATE',
        status: 'APPROVED',
        late_minutes: 30
    };
    // Mock moment at 09:02:00 (quá hạn 09:00:00, không được cộng thêm 5 phút)
    const fakeMoment = (...args) => {
        if (args.length === 0) {
            return moment('2026-09-29 09:02:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z');
        }
        return moment(...args);
    };
    Object.assign(fakeMoment, moment);

    const h = createHarness({ existingCheckin: null, policy, leaveRequest, customMoment: fakeMoment });

    const req = {
        body: { chat_id: '-1001', telegram_id: 'user1' },
        file: { path: '/tmp/checkin_leave_overdue.jpg', filename: 'checkin_leave_overdue.jpg' }
    };

    const result = await h.saveCheckin(req);
    assert.equal(result.ok, true);
    assert.equal(h.insertedCheckins.length, 1);
    assert.equal(h.insertedCheckins[0].checkinPenaltyAmount, 50000, 'Bị phạt 50.000đ do quá hạn 09:00');
    assert.match(result.message, /Đi muộn/);

    await result.runBackgroundTask();
    assert.equal(h.sentPhotos.length, 1);
    assert.match(h.sentPhotos[0].options.caption, /Quá thời gian xin đi muộn/);
});



