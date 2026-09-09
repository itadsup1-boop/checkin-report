import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLateAnnouncement } from '../domain/leave-request-rules.js';

test('nhận diện câu tự báo đi muộn và trích số phút dạng chữ số', () => {
    assert.deepEqual(parseLateAnnouncement('em xin đi muộn 15 phút ạ'), { matched: true, minutes: 15 });
    assert.deepEqual(parseLateAnnouncement('Chị ơi em đến trễ 20p nhé'), { matched: true, minutes: 20 });
});

test('trích được số phút viết bằng chữ', () => {
    assert.deepEqual(
        parseLateAnnouncement('em xin đi muộn năm phút vì trời mưa to quá ạ'),
        { matched: true, minutes: 5 }
    );
    assert.deepEqual(
        parseLateAnnouncement('cho em xin đến muộn mười lăm phút ạ'),
        { matched: true, minutes: 15 }
    );
});

test('có tín hiệu đi muộn nhưng không trích được số phút vẫn coi là matched, minutes null', () => {
    assert.deepEqual(parseLateAnnouncement('em xin đi muộn ạ, xe hỏng'), { matched: true, minutes: null });
});

test('không có cụm tín hiệu đi muộn/trễ thì không khớp', () => {
    assert.equal(parseLateAnnouncement('hôm nay em nghỉ cả ngày ạ').matched, false);
    assert.equal(parseLateAnnouncement('báo cáo: doanh thu hôm nay 500k').matched, false);
    assert.equal(parseLateAnnouncement('').matched, false);
    assert.equal(parseLateAnnouncement(undefined).matched, false);
});
