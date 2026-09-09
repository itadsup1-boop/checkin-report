/**
 * Worker: tải các file đã xếp hàng từ Telegram lên Google Drive.
 *
 * Chạy nền, 5 giây một nhịp, tối đa 3 file mỗi nhịp — đủ nhanh cho nhân viên mà
 * không đụng giới hạn API của Telegram lẫn Drive.
 *
 * Hỏng thì lùi lịch thử lại (1 → 5 → 15 → 30 phút) chứ không bỏ file: nhân viên
 * đã gửi ảnh thì không được bắt gửi lại.
 */

import { CUSTOMER_REPLY_ROLES, retryDelayMinutes } from '../domain/record-rules.js';

const TICK_MS = 5000;
const FIRST_TICK_DELAY_MS = 1500;
const MAX_JOBS_PER_TICK = 3;

/** Sau lần thử thứ 3 mới báo nhóm — báo sớm hơn chỉ làm nhân viên gửi lại thừa. */
const WARN_AFTER_ATTEMPTS = 3;

export function createTelegramMediaCollector({ repository, drive, notifier, initializationJobs }) {
    let busy = false;

    async function uploadJob(job) {
        // Hồ sơ có thể chưa tạo xong thư mục Drive. Chờ đúng job khởi tạo của nó,
        // nếu không sẽ có hai thư mục cho cùng một khách.
        const initializationJob = initializationJobs.get(job.customer_record_id);
        if (initializationJob) await initializationJob;

        const record = await repository.findRecordForUpload(job.customer_record_id);
        if (!record) throw new Error('Hồ sơ khách hàng không còn tồn tại.');
        if (!CUSTOMER_REPLY_ROLES.includes(record.bot_role)) {
            throw new Error('Nhóm không còn thuộc role hồ sơ khách hàng.');
        }

        const buffer = await notifier.downloadFile(job.telegram_file_id);
        const customerFolder = await drive.folderForCustomer(record.customer_drive_folder_id, record.phone);
        const uploaded = await drive.upload(
            buffer,
            job.file_name,
            job.mime_type || (job.media_type === 'video' ? 'video/mp4' : 'image/jpeg'),
            customerFolder.id
        );

        await repository.markMediaUploaded(job, {
            driveUrl: uploaded.webViewLink,
            folderLink: customerFolder.webViewLink
        });

        await notifier.markDone(job.telegram_chat_id, job.telegram_message_id);
    }

    async function failJob(job, error) {
        await repository.markMediaFailed(job, error.message || error, retryDelayMinutes(job.attempts));

        if (job.attempts === WARN_AFTER_ATTEMPTS) {
            await notifier.replyTo(
                job.telegram_chat_id,
                Number(job.telegram_message_id),
                '⚠️ Một file hồ sơ khách hàng chưa đồng bộ được lên Drive. Bot vẫn đang tự động thử lại; bạn không cần gửi lại file lúc này.'
            );
        }
    }

    async function processQueue() {
        if (busy) return;
        busy = true;
        try {
            for (let processed = 0; processed < MAX_JOBS_PER_TICK; processed += 1) {
                const job = await repository.claimNextMediaJob();
                if (!job) break;
                try {
                    await uploadJob(job);
                    console.log(`[Customer Telegram Reply] Đã đồng bộ media ${job.id} lên Drive.`);
                } catch (error) {
                    console.error(`[Customer Telegram Reply] Lỗi đồng bộ media ${job.id}:`, error);
                    await failJob(job, error);
                }
            }
        } catch (error) {
            // Khi migration chưa chạy hoặc DB tạm lỗi, không làm tiến trình Bot bị dừng.
            console.error('[Customer Telegram Reply Worker Error]:', error.message);
        } finally {
            busy = false;
        }
    }

    /**
     * `unref()` để worker không giữ tiến trình Bot sống khi cần thoát.
     * Trả về hàm dừng — dùng khi tắt máy hoặc trong test.
     */
    function start() {
        const tick = setInterval(processQueue, TICK_MS);
        tick.unref?.();
        const firstTick = setTimeout(processQueue, FIRST_TICK_DELAY_MS);
        firstTick.unref?.();
        return () => {
            clearInterval(tick);
            clearTimeout(firstTick);
        };
    }

    return { processQueue, start };
}
