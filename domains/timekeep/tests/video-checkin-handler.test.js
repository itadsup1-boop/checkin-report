import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { registerVideoCheckinHandler } from '../interfaces/telegram/register-video-checkin-handler.js';

test('registerVideoCheckinHandler ghi nhận check-in thành công khi gửi animation (GIF) kèm caption check-in (Clinic group)', async () => {
    let registeredEvents = null;
    let handler = null;
    const bot = {
        on(events, fn) {
            registeredEvents = events;
            handler = fn;
        }
    };

    const insertedCheckins = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'CLINIC' }; },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); }
    };

    let synced = false;
    const syncSheets = async () => { synced = true; };

    const findEmployeeContext = async (telegramId, groupId) => {
        if (telegramId === '123456' && groupId === '-100999') {
            return {
                id: 'emp-uuid-123',
                group_id: 'grp-uuid-1',
                full_name: 'Trần Quang Trung',
                role: 'Kỹ thuật viên'
            };
        }
        return null;
    };

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets, moment });

    assert.ok(registeredEvents.includes('animation'), 'Events phải chứa animation');
    assert.ok(registeredEvents.includes('photo'), 'Events phải chứa photo');

    const replies = [];
    const ctx = {
        chat: { id: -100999, type: 'supergroup' },
        message: {
            message_id: 88,
            from: { id: 123456, first_name: 'Trung' },
            date: 1789174680,
            caption: 'ktv trung check in',
            animation: {
                file_id: 'anim_file_abc_123',
                file_unique_id: 'anim_uniq_123',
                width: 320,
                height: 240
            }
        },
        reply: async (text, opts) => {
            replies.push({ text, opts });
        }
    };

    let nextCalled = false;
    await handler(ctx, () => { nextCalled = true; });

    assert.equal(insertedCheckins.length, 1, 'Phải insert vào checkinRepository');
    assert.equal(insertedCheckins[0].videoUrl, 'anim_file_abc_123');
    assert.equal(insertedCheckins[0].userId, 'emp-uuid-123');
    assert.equal(insertedCheckins[0].groupId, 'grp-uuid-1');
    assert.equal(insertedCheckins[0].workCredit, undefined, 'Clinic không có workCredit');
    assert.equal(replies.length, 1, 'Phải gửi tin nhắn reply xác nhận');
    assert.match(replies[0].text, /ĐÃ GHI NHẬN CHECK-IN/);
    assert.match(replies[0].text, /Trần Quang Trung/);
    assert.equal(synced, true, 'Phải kích hoạt đồng bộ Sheet');
    assert.equal(nextCalled, true, 'Phải gọi next() để chain middleware tiếp tục');
});

test('registerVideoCheckinHandler ghi nhận khi reply lại tin nhắn animation cũ với chữ check (Clinic group)', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'CLINIC' }; },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-uuid-123',
        group_id: 'grp-uuid-1',
        full_name: 'Trần Quang Trung',
        role: 'Kỹ thuật viên'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    const ctx = {
        chat: { id: -100999, type: 'supergroup' },
        message: {
            message_id: 89,
            from: { id: 123456, first_name: 'Trung' },
            date: 1789174700,
            text: 'check',
            reply_to_message: {
                message_id: 88,
                from: { id: 123456 },
                date: 1789174680,
                animation: { file_id: 'anim_file_replied_456' }
            }
        },
        reply: async () => {}
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].videoUrl, 'anim_file_replied_456');
});

test('Marketing Check-in: Đúng giờ trước 08:30 (08:15) -> 1.0 công, 0đ phạt', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-1',
        group_id: 'grp-mkt-1',
        full_name: 'Lê Marketing',
        role: 'Content'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 08:15:00 VN
    const ts0815 = moment('2026-09-24 08:15:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 101,
            from: { id: 999111, first_name: 'Lê' },
            date: ts0815,
            caption: 'Em Lê check in ngày 24/09/2026',
            video: { file_id: 'mkt_vid_ontime' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0);
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 0);
    assert.equal(latePenalties.length, 0, 'Đúng giờ không bị phạt');
    assert.match(replies[0].text, /CHECK-IN HỢP LỆ – MARKETING/);
    assert.match(replies[0].text, /Đúng giờ/);
});

test('Marketing Check-in: Muộn <= 60 phút (08:45) -> Phạt 50.000đ, vẫn 1.0 công', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-2',
        group_id: 'grp-mkt-1',
        full_name: 'Nguyễn Văn Muộn',
        role: 'Ads'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 08:45:00 VN (muộn 15 phút)
    const ts0845 = moment('2026-09-24 08:45:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 102,
            from: { id: 999222, first_name: 'Muộn' },
            date: ts0845,
            caption: 'check in',
            video: { file_id: 'mkt_vid_late15' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0);
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 50000);
    assert.equal(latePenalties.length, 1);
    assert.equal(latePenalties[0].amount, 50000);
    assert.equal(latePenalties[0].lateMinutes, 15);
    assert.match(replies[0].text, /GHI NHẬN ĐI MUỘN – MARKETING/);
    assert.match(replies[0].text, /50.000đ/);
    assert.match(replies[0].text, /Tính đủ 1.0 công/);
});

test('Marketing Check-in: Muộn > 60 phút (09:45) -> Phạt 50.000đ VÀ trừ 1/2 ngày công (còn 0.5 công)', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-3',
        group_id: 'grp-mkt-1',
        full_name: 'Hoàng Rất Muộn',
        role: 'Designer'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 09:45:00 VN (muộn 75 phút)
    const ts0945 = moment('2026-09-24 09:45:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 103,
            from: { id: 999333, first_name: 'Hoàng' },
            date: ts0945,
            caption: 'check in trễ',
            video: { file_id: 'mkt_vid_late75' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 0.5, 'Muộn > 60p phải trừ 1/2 công');
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 50000);
    assert.equal(latePenalties.length, 1);
    assert.equal(latePenalties[0].amount, 50000);
    assert.equal(latePenalties[0].lateMinutes, 75);
    assert.match(replies[0].text, /GHI NHẬN ĐI MUỘN – MARKETING/);
    assert.match(replies[0].text, /Trừ 1\/2 ngày công/);
    assert.match(replies[0].text, /0.5 công/);
    assert.match(replies[0].text, /50.000đ/);
});

test('Marketing Check-out: Trước 18:30 (17:45) kèm ảnh -> Bị từ chối và cảnh báo', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const recordedCheckouts = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return { id: 1, check_in_time: '2026-09-24 08:10:00' }; },
        async recordCheckOut(data) { recordedCheckouts.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-1',
        group_id: 'grp-mkt-1',
        full_name: 'Lê Marketing',
        role: 'Content'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 17:45:00 VN
    const ts1745 = moment('2026-09-24 17:45:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 104,
            from: { id: 999111, first_name: 'Lê' },
            date: ts1745,
            caption: '#checkout',
            photo: [{ file_id: 'photo_early_checkout' }]
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(recordedCheckouts.length, 0, 'Không được ghi nhận check-out trước 18:30');
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /chưa đến giờ kết thúc ca làm việc/);
    assert.match(replies[0].text, /sau 18:30/);
});

test('Marketing Check-out: Sau 18:30 (18:45) bằng tin nhắn #checkout sau khi gửi ảnh trước đó -> Thành công', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const recordedCheckouts = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return { id: 1, check_in_time: '2026-09-24 08:10:00' }; },
        async recordCheckOut(data) { recordedCheckouts.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-1',
        group_id: 'grp-mkt-1',
        full_name: 'Lê Marketing',
        role: 'Content'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 18:45:00 VN
    const ts1845 = moment('2026-09-24 18:45:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];

    // 1. Gửi ảnh ngay trước đó (ví dụ 10 giây trước)
    await handler({
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 104,
            from: { id: 999111, first_name: 'Lê' },
            date: ts1845 - 10,
            photo: [{ file_id: 'photo_desk_prev_104' }]
        }
    }, () => {});

    // 2. Gửi tin nhắn text #checkout ngay sau đó
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 105,
            from: { id: 999111, first_name: 'Lê' },
            date: ts1845,
            text: '#checkout'
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(recordedCheckouts.length, 1);
    assert.equal(recordedCheckouts[0].userId, 'emp-mkt-1');
    assert.equal(recordedCheckouts[0].mediaFileId, 'photo_desk_prev_104', 'Lấy đúng file_id của ảnh đã gửi ngay trước đó');
    assert.equal(recordedCheckouts[0].checkoutStatus, 'HOAN_THANH');
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /CHECK-OUT THÀNH CÔNG – MARKETING/);
    assert.match(replies[0].text, /Lê Marketing/);
});

test('Marketing Check-out: Sau 18:30 bằng ảnh bàn làm việc kèm caption checkout -> Thành công', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const recordedCheckouts = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return { id: 1, check_in_time: '2026-09-24 08:10:00' }; },
        async recordCheckOut(data) { recordedCheckouts.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-2',
        group_id: 'grp-mkt-1',
        full_name: 'Nguyễn Văn Muộn',
        role: 'Ads'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 19:00:00 VN
    const ts1900 = moment('2026-09-24 19:00:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 106,
            from: { id: 999222, first_name: 'Muộn' },
            date: ts1900,
            caption: 'checkout ca làm việc',
            photo: [{ file_id: 'photo_desk_123', width: 800, height: 600 }]
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(recordedCheckouts.length, 1);
    assert.equal(recordedCheckouts[0].userId, 'emp-mkt-2');
    assert.equal(recordedCheckouts[0].mediaFileId, 'photo_desk_123');
    assert.equal(recordedCheckouts[0].checkoutStatus, 'HOAN_THANH');
    assert.match(replies[0].text, /CHECK-OUT THÀNH CÔNG – MARKETING/);
});

test('Marketing Check-out: Quên check-in mà đòi check-out (có ảnh) -> Báo lỗi', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return null; }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-1',
        group_id: 'grp-mkt-1',
        full_name: 'Lê Marketing',
        role: 'Content'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    const ts1845 = moment('2026-09-24 18:45:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 107,
            from: { id: 999111, first_name: 'Lê' },
            date: ts1845,
            caption: 'checkout',
            photo: [{ file_id: 'photo_desk_fail' }]
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /chưa thực hiện check-in/);
});

test('Marketing Check-out: Tin nhắn chat chứa chữ check out nhưng KHÔNG CÓ ảnh/video -> Bot hoàn toàn im lặng', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const recordedCheckouts = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return { id: 1, check_in_time: '2026-09-24 08:10:00' }; },
        async recordCheckOut(data) { recordedCheckouts.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-1',
        group_id: 'grp-mkt-1',
        full_name: 'Lê Marketing',
        role: 'Content'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    const ts1845 = moment('2026-09-24 18:45:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    let nextCalled = false;

    // Tin nhắn chat thông thường nhắc đến chữ check out
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 108,
            from: { id: 999111, first_name: 'Lê' },
            date: ts1845,
            text: 'check out nó ở đâu anh ơi?'
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => { nextCalled = true; });

    assert.equal(recordedCheckouts.length, 0, 'Không ghi nhận check-out');
    assert.equal(replies.length, 0, 'Bot hoàn toàn không gửi thông báo hay phản hồi gì');
    assert.equal(nextCalled, true, 'Bỏ qua và chuyển tiếp middleware');
});

test('Marketing Check-in: Gửi lặp lại khi đã check-in trong ngày -> Thông báo đã check-in', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-24' }; },
        async findCheckInOfDay() { return { id: 99, check_in_time: '2026-09-24 08:20:00' }; },
        async insertCheckIn(data) { insertedCheckins.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-1',
        group_id: 'grp-mkt-1',
        full_name: 'Lê Marketing',
        role: 'Content'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    const ts0825 = moment('2026-09-24 08:25:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 108,
            from: { id: 999111, first_name: 'Lê' },
            date: ts0825,
            caption: 'checkin lại',
            video: { file_id: 'mkt_vid_dup' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 0, 'Không insert lại lần 2');
    assert.equal(replies.length, 1);
    assert.match(replies[0].text, /hôm nay bạn đã check-in rồi/);
});

test('Marketing: Trước ngày bắt đầu (25/09) -> Check-out sớm không bị cảnh báo, Check-in muộn không bị phạt', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        // Không truyền effective_start_date -> mặc định là 2026-09-25
        async findGroupPolicy() { return { attendance_policy: 'MARKETING' }; },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-mkt-trial',
        group_id: 'grp-mkt-1',
        full_name: 'Boss Hỗ Trợ',
        role: 'Marketing'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 1. Gửi check-out sớm lúc 13:40 ngày 24/09 (trước 25/09) -> Không bị cảnh báo chặn
    const ts1340 = moment('2026-09-24 13:40:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const repliesCheckout = [];
    let nextCalled = false;
    const ctxCheckout = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 201,
            from: { id: 8634311806, first_name: 'Boss' },
            date: ts1340,
            text: 'ở bước check in mn sẽ gửi video kèm caption tên + checkout'
        },
        reply: async (text, opts) => repliesCheckout.push({ text, opts })
    };

    await handler(ctxCheckout, () => { nextCalled = true; });
    assert.equal(repliesCheckout.length, 0, 'Không cảnh báo chặn checkout khi đang hướng dẫn/thử nghiệm');
    assert.equal(nextCalled, true);

    // 2. Gửi check-in lúc 14:00 ngày 24/09 (trước 25/09) -> Vẫn đủ 1.0 công, phạt 0đ
    const ts1400 = moment('2026-09-24 14:00:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const repliesCheckin = [];
    const ctxCheckin = {
        chat: { id: -100888, type: 'supergroup' },
        message: {
            message_id: 202,
            from: { id: 8634311806, first_name: 'Boss' },
            date: ts1400,
            caption: 'Boss check in',
            video: { file_id: 'vid_trial' }
        },
        reply: async (text, opts) => repliesCheckin.push({ text, opts })
    };

    await handler(ctxCheckin, () => {});
    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0, 'Được tính đủ 1.0 công khi chạy thử');
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 0, 'Phạt 0đ khi chạy thử');
    assert.equal(latePenalties.length, 0, 'Không phạt tiền');
});

test('Video check-in: gửi file video dưới dạng document (.mp4) vẫn ghi nhận thành công', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const checkinRepository = {
        async findGroupPolicy() { return { attendance_policy: 'MARKETING', effective_start_date: '2026-09-25' }; },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty() {}
    };
    const findEmployeeContext = async () => ({
        id: 'emp-boss',
        group_id: 'grp-test',
        full_name: 'Boss',
        role: 'Quản lý'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    const replies = [];
    const ctx = {
        chat: { id: -1004434178722, type: 'supergroup' },
        message: {
            message_id: 301,
            from: { id: 8634311806, first_name: 'Boss' },
            date: moment('2026-09-25 09:51:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix(),
            caption: 'boss check in',
            document: {
                file_name: 'video_2026-07-27_11-46-48.mp4',
                mime_type: 'video/mp4',
                file_id: 'doc_video_mp4_file_id'
            }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});
    assert.equal(insertedCheckins.length, 1, 'Phải ghi nhận check-in từ document video');
    assert.equal(insertedCheckins[0].videoUrl, 'doc_video_mp4_file_id');
    assert.equal(replies.length, 1, 'Bot phải trả lời tin nhắn xác nhận');
});

test('Marketing Check-in: Chủ Nhật nhóm Adsup check-in lúc 08:39 (trước 09:00) -> Đúng giờ, 1.0 công, 0đ phạt', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() {
            return {
                attendance_policy: 'MARKETING',
                effective_start_date: '2026-09-24',
                marketing_checkin_deadline: '08:30:00',
                marketing_sunday_checkin_deadline: '09:00:00',
                marketing_sunday_late_cutoff: '10:00:00',
                marketing_checkin_penalty: 50000
            };
        },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'u-adsup-1',
        group_id: 'g-adsup',
        full_name: 'Trịnh Quốc Việt',
        role: 'Marketing'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 2026-09-27 08:39:45 VN (Chủ Nhật)
    const sundayTs = moment('2026-09-27 08:39:45 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: '-5470063387', type: 'group' },
        message: {
            message_id: 888,
            from: { id: 9999, first_name: 'Việt' },
            date: sundayTs,
            caption: 'Việt check in',
            video: { file_id: 'vid-sunday-123' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0);
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 0);
    assert.equal(latePenalties.length, 0, 'Chủ Nhật trước 9h không bị phạt');
    assert.match(replies[0].text, /CHECK-IN HỢP LỆ – MARKETING/);
    assert.match(replies[0].text, /Đúng giờ/);
});

test('Marketing Check-in: Nhóm khác vào Chủ Nhật vẫn giữ mốc 08:30 chuẩn (không bị áp dụng mốc 9h của Adsup)', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() {
            return {
                attendance_policy: 'MARKETING',
                effective_start_date: '2026-09-24',
                marketing_checkin_deadline: '08:30:00',
                marketing_sunday_checkin_deadline: null,
                marketing_sunday_late_cutoff: null,
                marketing_checkin_penalty: 50000
            };
        },
        async findCheckInOfDay() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'u-namdong-1',
        group_id: 'g-namdong',
        full_name: 'Nguyễn Văn Nam',
        role: 'Marketing'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 2026-09-27 08:39:45 VN (Chủ Nhật)
    const sundayTs = moment('2026-09-27 08:39:45 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: '-5589101669', type: 'group' }, // Nhóm Nam Đồng
        message: {
            message_id: 889,
            from: { id: 8888, first_name: 'Nam' },
            date: sundayTs,
            caption: 'Nam check in',
            video: { file_id: 'vid-sunday-namdong' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0);
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 50000);
    assert.equal(latePenalties.length, 1, 'Nhóm khác check-in lúc 08:39 vẫn tính muộn theo mốc 08:30');
    assert.match(replies[0].text, /GHI NHẬN ĐI MUỘN/);
});

test('Marketing Check-in: Nhân sự đăng ký Ca 2 check-in lúc 09:20 -> Đúng giờ (mốc 09:30)', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() {
            return {
                attendance_policy: 'MARKETING',
                marketing_checkin_deadline: '08:30:00',
                marketing_late_cutoff: '09:30:00',
                marketing_checkin_penalty: 50000,
                effective_start_date: '2026-09-24'
            };
        },
        async findCheckInOfDay() { return null; },
        async findUserScheduleOfDay() { return { shift_type: 'CA_2' }; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-ca2-1',
        group_id: 'grp-ca2-1',
        full_name: 'Nguyễn Ca Hai',
        role: 'Telesale'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // 09:20:00 ngày thường
    const ts0920 = moment('2026-09-29 09:20:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100999, type: 'group' },
        message: {
            message_id: 991,
            from: { id: 7777, first_name: 'Hai' },
            date: ts0920,
            caption: 'check in',
            video: { file_id: 'vid-ca2-on-time' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0);
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 0);
    assert.equal(latePenalties.length, 0);
    assert.match(replies[0].text, /CHECK-IN HỢP LỆ/);
    assert.match(replies[0].text, /Đúng giờ/);
});

test('Marketing Check-in: Có đơn xin đi muộn đã duyệt (+60p) -> Mốc chốt dời từ 08:30 thành 09:30, check-in 09:15 đúng giờ', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() {
            return {
                attendance_policy: 'MARKETING',
                marketing_checkin_deadline: '08:30:00',
                marketing_late_cutoff: '09:30:00',
                marketing_checkin_penalty: 50000,
                effective_start_date: '2026-09-24'
            };
        },
        async findCheckInOfDay() { return null; },
        async findUserScheduleOfDay() { return null; }, // ca 1 (08:30)
        async findApprovedLateLeaveRequest() {
            return {
                id: 'leave-1',
                leave_type: 'LATE',
                status: 'APPROVED',
                late_minutes: 60
            };
        },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-viet-1',
        group_id: 'grp-viet-1',
        full_name: 'Trịnh Quốc Việt',
        role: 'Marketing'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // Check in lúc 09:15:00 ngày thường 2026-09-28
    const ts0915 = moment('2026-09-28 09:15:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100999, type: 'group' },
        message: {
            message_id: 992,
            from: { id: 8888, first_name: 'Việt' },
            date: ts0915,
            caption: 'check in',
            video: { file_id: 'vid-viet-late-approved' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0, 'Được tính đủ 1.0 công');
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 0, '0đ phạt');
    assert.match(replies[0].text, /CHECK-IN HỢP LỆ/);
    assert.match(replies[0].text, /Xin muộn \+60p/);
    assert.match(replies[0].text, /Có đơn xin đi muộn hợp lệ/);
});

test('Marketing Check-in: Check-in lúc 08:33 (sau 08:30 nhưng trong 5 phút ân hạn) -> Đúng giờ, 1.0 công, 0đ phạt', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() {
            return {
                attendance_policy: 'MARKETING',
                effective_start_date: '2026-09-24',
                marketing_checkin_deadline: '08:30:00',
                marketing_late_cutoff: '09:30:00',
                marketing_checkin_penalty: 50000
            };
        },
        async findCheckInOfDay() { return null; },
        async findUserScheduleOfDay() { return null; },
        async findApprovedLateLeaveRequest() { return null; },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-long-1',
        group_id: 'grp-namdong-1',
        full_name: 'Vũ Quang Long',
        role: 'Marketing'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // Check in lúc 08:33:02 ngày 2026-09-29
    const ts0833 = moment('2026-09-29 08:33:02 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100999, type: 'group' },
        message: {
            message_id: 993,
            from: { id: 8239, first_name: 'Long' },
            date: ts0833,
            caption: 'check in',
            video: { file_id: 'vid-long-0833' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].workCredit, 1.0, 'Được tính đủ 1.0 công do trong 5 phút ân hạn');
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 0, '0đ phạt');
    assert.equal(latePenalties.length, 0, 'Không ghi nhận phạt');
    assert.match(replies[0].text, /CHECK-IN HỢP LỆ/);
    assert.match(replies[0].text, /Đúng giờ/);
});

test('Marketing Check-in: Có đơn xin đi muộn 30 phút (hạn 09:00), check-in lúc 09:02 -> Đi muộn (không cộng thêm 5 phút)', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const latePenalties = [];
    const checkinRepository = {
        async findGroupPolicy() {
            return {
                attendance_policy: 'MARKETING',
                effective_start_date: '2026-09-24',
                marketing_checkin_deadline: '08:30:00',
                marketing_late_cutoff: '09:30:00',
                marketing_checkin_penalty: 50000
            };
        },
        async findCheckInOfDay() { return null; },
        async findUserScheduleOfDay() { return null; },
        async findApprovedLateLeaveRequest() {
            return {
                id: 'leave-30m',
                leave_type: 'LATE',
                status: 'APPROVED',
                late_minutes: 30
            };
        },
        async insertCheckIn(data) { insertedCheckins.push(data); },
        async insertLatePenalty(data) { latePenalties.push(data); }
    };
    const findEmployeeContext = async () => ({
        id: 'emp-viet-2',
        group_id: 'grp-viet-2',
        full_name: 'Trịnh Quốc Việt',
        role: 'Marketing'
    });

    registerVideoCheckinHandler({ bot, checkinRepository, findEmployeeContext, syncSheets: async () => {}, moment });

    // Check in lúc 09:02:00 ngày 2026-09-28 (quá 09:00:00)
    const ts0902 = moment('2026-09-28 09:02:00 +07:00', 'YYYY-MM-DD HH:mm:ss Z').unix();
    const replies = [];
    const ctx = {
        chat: { id: -100999, type: 'group' },
        message: {
            message_id: 994,
            from: { id: 8888, first_name: 'Việt' },
            date: ts0902,
            caption: 'check in',
            video: { file_id: 'vid-viet-overdue' }
        },
        reply: async (text, opts) => replies.push({ text, opts })
    };

    await handler(ctx, () => {});

    assert.equal(insertedCheckins.length, 1);
    assert.equal(insertedCheckins[0].checkinPenaltyAmount, 50000, 'Phạt 50.000đ do quá hạn 09:00');
    assert.equal(latePenalties.length, 1, 'Ghi nhận phạt muộn');
    assert.match(replies[0].text, /GHI NHẬN ĐI MUỘN/);
    assert.match(replies[0].text, /Quá thời gian xin đi muộn/);
});




