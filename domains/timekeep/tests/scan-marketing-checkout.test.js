import test from 'node:test';
import assert from 'node:assert/strict';
import moment from 'moment';
import { createScanMarketingCheckout } from '../application/scan-marketing-checkout.js';

test('scanEveningCheckout áp phạt 20.000đ cho nhân viên Marketing quên check-out', async () => {
    const marked = [];
    const insertedPenalties = [];
    const sentMessages = [];
    let synced = false;

    const checkinRepository = {
        async findMarketingUncheckedOut({ date }) {
            if (date === '2026-09-24') {
                return [
                    { id: 'c1', group_id: 'g1', user_id: 'u1', date: '2026-09-24', full_name: 'Nguyễn Văn A', telegram_group_id: '-10099' },
                    { id: 'c2', group_id: 'g1', user_id: 'u2', date: '2026-09-24', full_name: 'Trần Thị B', telegram_group_id: '-10099' }
                ];
            }
            return [];
        },
        async markMissedCheckout(payload) {
            marked.push(payload);
        },
        async insertCheckoutPenalty(payload) {
            insertedPenalties.push(payload);
        }
    };

    const sendMessageToRoleGroup = async (bot, groupId, role, msg, opts, tag) => {
        sentMessages.push({ groupId, role, msg, tag });
    };

    const syncSheets = async () => {
        synced = true;
    };

    const { scanEveningCheckout } = createScanMarketingCheckout({
        checkinRepository,
        bot: {},
        sendMessageToRoleGroup,
        moment,
        syncSheets,
        effectiveStartDate: '2026-09-24'
    });

    const res = await scanEveningCheckout('2026-09-24');
    assert.equal(res, true);
    assert.equal(marked.length, 2);
    assert.equal(marked[0].checkinId, 'c1');
    assert.equal(marked[0].penaltyAmount, 20000);

    assert.equal(insertedPenalties.length, 2);
    assert.equal(insertedPenalties[0].amount, 20000);
    assert.equal(insertedPenalties[0].violation_type, undefined); // payload has amount, reason, date...

    assert.equal(sentMessages.length, 1);
    assert.match(sentMessages[0].msg, /THÔNG BÁO QUÊN CHECK-OUT/);
    assert.match(sentMessages[0].msg, /40\.000đ/);
    assert.equal(synced, true);
});

test('scanEveningCheckout bỏ qua khi ngày quét trước ngày có hiệu lực 29/09/2026', async () => {
    let called = false;
    const checkinRepository = {
        async findMarketingUncheckedOut() {
            called = true;
            return [];
        }
    };

    const { scanEveningCheckout } = createScanMarketingCheckout({
        checkinRepository,
        bot: {},
        sendMessageToRoleGroup: async () => {},
        moment,
        syncSheets: async () => {}
    });

    // Ngày 28/09/2026 trước 29/09/2026 -> phải bỏ qua, không quét
    const res = await scanEveningCheckout('2026-09-28');
    assert.equal(res, false);
    assert.equal(called, false);
});

test('scanEveningCheckout không làm gì nếu không có ai vi phạm', async () => {
    const checkinRepository = {
        async findMarketingUncheckedOut() {
            return [];
        }
    };

    const { scanEveningCheckout } = createScanMarketingCheckout({
        checkinRepository,
        bot: {},
        sendMessageToRoleGroup: async () => {},
        moment,
        syncSheets: async () => {},
        effectiveStartDate: '2026-09-24'
    });

    const res = await scanEveningCheckout('2026-09-24');
    assert.equal(res, false);
});
