import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseKtvNames,
    calculateTourCredit,
    normalizeReportDate,
    parseTourMessage,
    buildTourReportNotice,
    buildDailyTourSummaryMessage
} from '../domain/tour-report-parser.js';
import { createTourReportRepository } from '../infrastructure/postgres/tour-report-repository.js';
import { createProcessTourReportService } from '../application/process-tour-report.js';

test('parseKtvNames tách đúng tên KTV đơn hoặc nhiều KTV', () => {
    assert.deepEqual(parseKtvNames('Huệ'), ['Huệ']);
    assert.deepEqual(parseKtvNames('Huệ, Kiều'), ['Huệ', 'Kiều']);
    assert.deepEqual(parseKtvNames('Huệ + Kiều'), ['Huệ', 'Kiều']);
    assert.deepEqual(parseKtvNames('Huệ / Kiều'), ['Huệ', 'Kiều']);
    assert.deepEqual(parseKtvNames('Huệ và Linh'), ['Huệ', 'Linh']);
    assert.deepEqual(parseKtvNames('Huệ (123)'), ['Huệ']);
    assert.deepEqual(parseKtvNames(''), []);
});

test('calculateTourCredit tính đúng 1.0 cho 1 KTV và 0.5 cho 2 KTV', () => {
    assert.equal(calculateTourCredit(0), 0);
    assert.equal(calculateTourCredit(1), 1.0);
    assert.equal(calculateTourCredit(2), 0.5);
    assert.equal(calculateTourCredit(3), 0.33);
});

test('normalizeReportDate chuẩn hoá ngày chính xác', () => {
    const fixedNow = new Date('2026-09-21T10:00:00Z');
    assert.equal(normalizeReportDate('21/9', fixedNow), '2026-09-21');
    assert.equal(normalizeReportDate('21-09', fixedNow), '2026-09-21');
    assert.equal(normalizeReportDate('21/09/2026', fixedNow), '2026-09-21');
    assert.equal(normalizeReportDate('', fixedNow), '2026-09-21');
});

test('parseTourMessage nhận diện đầy đủ mẫu báo tour 1 KTV', () => {
    const raw = `Ngày: 21/9
Khách: Lê Bích Thủy
Bác sĩ: BS Tuấn
SĐT: 0908461234
DV: RF / Tái khám B2
KTV: Huệ`;

    const parsed = parseTourMessage(raw, { hasPhoto: true, now: new Date('2026-09-21') });
    assert.equal(parsed.isValid, true);
    assert.equal(parsed.reportDate, '2026-09-21');
    assert.equal(parsed.customerName, 'Lê Bích Thủy');
    assert.equal(parsed.customerType, 'Khách cũ');
    assert.equal(parsed.doctor, 'BS Tuấn');
    assert.equal(parsed.phone, '0908461234');
    assert.equal(parsed.service, 'RF / Tái khám B2');
    assert.deepEqual(parsed.ktvNames, ['Huệ']);
    assert.equal(parsed.tourCredit, 1.0);
    assert.equal(parsed.missingReason, null);
});

test('parseTourMessage tính 0.5 công mỗi người khi có 2 KTV', () => {
    const raw = `Ngày: 21/9
Khách: Trần Thị Mai
Bác sĩ: BS Nam
SĐT: 0912345678
DV: Chăm sóc da chuyên sâu
KTV: Huệ, Kiều`;

    const parsed = parseTourMessage(raw, { hasPhoto: true, now: new Date('2026-09-21') });
    assert.equal(parsed.isValid, true);
    assert.deepEqual(parsed.ktvNames, ['Huệ', 'Kiều']);
    assert.equal(parsed.tourCredit, 0.5);
});

test('parseTourMessage nhận diện Khách mới khi có ghi chú', () => {
    const raw1 = `Khách: Nguyễn Thu Hà (khách mới)
Bác sĩ: BS Tuấn
SĐT: 0988776655
DV: Trị mụn
KTV: Linh`;
    const parsed1 = parseTourMessage(raw1, { hasPhoto: true });
    assert.equal(parsed1.customerType, 'Khách mới');
    assert.equal(parsed1.customerName, 'Nguyễn Thu Hà');
    assert.equal(parsed1.isValid, true);

    const raw2 = `Khách: Phạm Hải
Loại khách: Khách mới
Bác sĩ: BS Lan
SĐT: 0977112233
DV: Chăm sóc da
KTV: Kiều`;
    const parsed2 = parseTourMessage(raw2, { hasPhoto: true });
    assert.equal(parsed2.customerType, 'Khách mới');
    assert.equal(parsed2.isValid, true);
});

test('parseTourMessage từ chối tính công nếu thiếu bất kỳ mục bắt buộc nào', () => {
    const noPhoto = parseTourMessage('Khách: Anh A\nBác sĩ: BS B\nSĐT: 09123\nDV: Laser\nKTV: Huệ', { hasPhoto: false });
    assert.equal(noPhoto.isValid, false);
    assert.match(noPhoto.missingReason, /Thiếu ảnh chứng thực/);

    const noKtv = parseTourMessage('Khách: Anh A\nBác sĩ: BS B\nSĐT: 09123\nDV: Laser', { hasPhoto: true });
    assert.equal(noKtv.isValid, false);
    assert.match(noKtv.missingReason, /Thiếu tên KTV/);

    const noCust = parseTourMessage('Bác sĩ: BS B\nDV: Laser\nKTV: Huệ', { hasPhoto: true });
    assert.equal(noCust.isValid, false);
    assert.match(noCust.missingReason, /Thiếu tên khách hàng/);

    const noDoc = parseTourMessage('Khách: Anh A\nSĐT: 09123\nDV: Laser\nKTV: Huệ', { hasPhoto: true });
    assert.equal(noDoc.isValid, false);
    assert.match(noDoc.missingReason, /Thiếu tên bác sĩ phụ trách/);

    const noService = parseTourMessage('Khách: Anh A\nBác sĩ: BS B\nSĐT: 09123\nKTV: Huệ', { hasPhoto: true });
    assert.equal(noService.isValid, false);
    assert.match(noService.missingReason, /Thiếu tên dịch vụ/);
});

test('buildTourReportNotice tạo thông báo Telegram đẹp mắt', () => {
    const notice = buildTourReportNotice({
        reportDate: '2026-09-21',
        customerName: 'Lê Bích Thủy',
        customerType: 'Khách cũ',
        doctor: 'BS Tuấn',
        phone: '0908461234',
        service: 'RF / Tái khám B2',
        ktvNames: ['Huệ', 'Kiều'],
        tourCredit: 0.5
    });
    assert.match(notice, /Ngày: 21\/09/);
    assert.match(notice, /Khách: Lê Bích Thủy \(Khách cũ\)/);
    assert.match(notice, /Bác sĩ: BS Tuấn/);
    assert.match(notice, /KTV: Huệ \(0.5 công\), Kiều \(0.5 công\)/);
});

test('parseTourMessage đọc được ghi chú và đưa vào notice', () => {
    const raw = `Khách: Hoàng Mai
Bác sĩ: BS Cường
SĐT: 0911223344
DV: Cấy tảo
KTV: Ngân
Ghi chú: Khách hẹn làm thêm buổi sau`;
    const parsed = parseTourMessage(raw, { hasPhoto: true });
    assert.equal(parsed.notes, 'Khách hẹn làm thêm buổi sau');
    const notice = buildTourReportNotice(parsed);
    assert.match(notice, /Ghi chú: Khách hẹn làm thêm buổi sau/);
});

test('buildDailyTourSummaryMessage tổng hợp công tour cuối ngày 22:00', () => {
    const summaries = [
        { ktv_name: 'Huệ', total_credit: '5' },
        { ktv_name: 'Kiều', total_credit: '7' },
        { ktv_name: 'Linh', total_credit: '4.5' }
    ];
    const msg = buildDailyTourSummaryMessage(summaries, 16.5, '21/09/2026');
    assert.match(msg, /TỔNG HỢP CÔNG TOUR NGÀY 21\/09\/2026/);
    assert.match(msg, /Huệ: 5 tour/);
    assert.match(msg, /Kiều: 7 tour/);
    assert.match(msg, /Linh: 4.5 tour/);
    assert.match(msg, /Tổng: 16.5 tour/);
});

test('buildDailyTourSummaryMessage hiển thị thông báo khi chưa có tour', () => {
    const emptyMsg = buildDailyTourSummaryMessage([], 0, '21/09/2026');
    assert.match(emptyMsg, /chưa có công tour nào được ghi nhận/);
});

test('tour-report-repository insert và kiểm tra trùng lặp với mock pool', async () => {
    const queries = [];
    const mockPool = {
        async query(sql, params) {
            queries.push({ sql, params });
            if (sql.includes('INSERT INTO ktv_tour_reports')) {
                return { rows: [{ id: 101, ...params }] };
            }
            if (sql.includes('SELECT id, customer_name, phone, service')) {
                if (params[2] === '0908461234') {
                    return { rows: [{ id: 99, customer_name: 'Đã có' }] };
                }
                return { rows: [] };
            }
            if (sql.includes('WITH matched_tours')) {
                return {
                    rows: [{ today_credit: '2.5', month_credit: '12.0', total_credit: '45.5', total_count: '50' }]
                };
            }
            if (sql.includes('FROM ktv_tour_reports') && sql.includes('GROUP BY ktv_name')) {
                return {
                    rows: [
                        { ktv_name: 'Huệ', total_credit: '3' },
                        { ktv_name: 'Kiều', total_credit: '2.5' }
                    ]
                };
            }
            if (sql.includes('FROM ktv_tour_reports') && sql.includes('ORDER BY report_date DESC')) {
                return { rows: [{ id: 101, customer_name: 'Test Khách', ktv_names: ['Huệ'], telegram_user_id: 123456 }] };
            }
            return { rows: [] };
        }
    };

    const repo = createTourReportRepository({ pool: mockPool });

    // Kiểm tra duplicate
    const dup = await repo.findDuplicateToday('-4815602983', '2026-09-21', '0908461234', 'RF');
    assert.equal(dup.id, 99);

    const nonDup = await repo.findDuplicateToday('-4815602983', '2026-09-21', '0999999999', 'RF');
    assert.equal(nonDup, null);

    // Kiểm tra getKtvStats
    const stats = await repo.getKtvStats(123456, 'Huệ', '-4815602983', '2026-09-21');
    assert.equal(stats.todayCredit, 2.5);
    assert.equal(stats.monthCredit, 12);
    assert.equal(stats.totalCredit, 45.5);

    // Kiểm tra getDailyGroupSummary
    const summary = await repo.getDailyGroupSummary('-4815602983', '2026-09-21');
    assert.equal(summary.totalTours, 5.5);
    assert.equal(summary.ktvSummaries.length, 2);

    // Kiểm tra findRecentTours lọc theo người dùng
    const recent = await repo.findRecentTours('-4815602983', { limit: 10, telegramUserId: 123456, ktvName: 'Huệ' });
    assert.equal(recent.length, 1);
    assert.equal(recent[0].id, 101);
});

test('process-tour-report xử lý submit báo tour và báo trùng', async () => {
    let duplicateChecked = false;
    let appointmentUpdated = false;
    const mockRepo = {
        findDuplicateToday: async () => {
            duplicateChecked = true;
            return null; // Không trùng
        },
        insertTourReport: async data => ({ id: 202, ...data }),
        markAppointmentCompleted: async () => {
            appointmentUpdated = true;
        }
    };
    const mockBot = {
        telegram: {
            sendPhoto: async () => ({ message_id: 888 })
        }
    };

    let sentGroupPhoto = false;
    const processor = createProcessTourReportService({
        repository: mockRepo,
        sendPhotoToRoleGroup: async () => { sentGroupPhoto = true; },
        sendMessageToRoleGroup: async () => {},
        bot: mockBot,
        moment: () => ({ format: () => '2026-09-21' }),
        fs: { existsSync: () => true, mkdirSync: () => {}, writeFileSync: () => {} },
        path: { join: (...args) => args.join('/') },
        uploadDir: 'uploads',
        publicBaseUrl: 'http://localhost:3000'
    });

    const result = await processor.submitFromMiniApp({
        groupId: '-4815602983',
        reportedBy: 'Huệ',
        telegramUserId: 12345,
        reportDate: '2026-09-21',
        customerName: 'Nguyễn Văn A',
        customerType: 'Khách cũ',
        phone: '0987654321',
        doctor: 'BS Tuấn',
        service: 'Laser',
        ktvNames: ['Huệ', 'Kiều'],
        imageBase64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        appointmentId: 55
    });

    assert.equal(duplicateChecked, true);
    assert.equal(result.success, true);
    assert.equal(result.data.tourCredit, 0.5);
    assert.equal(appointmentUpdated, true);
    assert.equal(sentGroupPhoto, true);
});
