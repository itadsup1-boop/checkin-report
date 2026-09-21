import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { registerVideoCheckinHandler } from '../interfaces/telegram/register-video-checkin-handler.js';

test('registerVideoCheckinHandler ghi nhận check-in thành công khi gửi animation (GIF) kèm caption check-in', async () => {
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
        async insertCheckIn(data) {
            insertedCheckins.push(data);
        }
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
    assert.equal(replies.length, 1, 'Phải gửi tin nhắn reply xác nhận');
    assert.match(replies[0].text, /ĐÃ GHI NHẬN CHECK-IN/);
    assert.match(replies[0].text, /Trần Quang Trung/);
    assert.equal(synced, true, 'Phải kích hoạt đồng bộ Sheet');
    assert.equal(nextCalled, true, 'Phải gọi next() để chain middleware tiếp tục');
});

test('registerVideoCheckinHandler ghi nhận khi reply lại tin nhắn animation cũ với chữ check', async () => {
    let handler = null;
    const bot = { on(events, fn) { handler = fn; } };
    const insertedCheckins = [];
    const checkinRepository = { async insertCheckIn(data) { insertedCheckins.push(data); } };
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
