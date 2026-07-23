────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

• Kế hoạch sửa nên theo nguyên tắc “lọc từ truy vấn và kiểm tra lại ngay trước khi gửi”, để dữ liệu cũ hoặc sai cũng không thể làm gửi nhầm.

  ### 1. Tạo lớp gửi Telegram theo role dùng chung

  Trong apps/bot/role_guard.js, bổ sung:

  sendMessageToRoleGroup(bot, groupId, requiredRole, message, options)
  sendPhotoToRoleGroup(bot, groupId, requiredRole, photo, options)

  Mỗi hàm phải:

  - Gọi getGroupRole(groupId).
  - Chỉ gửi nếu role đúng.
  - Chặn nhóm inactive hoặc đã xóa.
  - Ghi log khi chặn, gồm groupId, role thực tế và nguồn gửi.
  - Không cho phép gửi nếu không tìm thấy cấu hình nhóm.

  Đây là lớp bảo vệ cuối cùng cho mọi cron và API.

  ### 2. Thay toàn bộ lệnh gửi tự động của module report

  Trong apps/bot/kpi_features.js, thay các lệnh gửi trực tiếp:

  bot.telegram.sendMessage(...)
  bot.telegram.sendPhoto(...)
  bot.telegram.sendMediaGroup(...)

  bằng helper yêu cầu:

  requiredRole = 'report'

  Ưu tiên các khu vực:

  - Cron nhắc nộp KPI.
  - Cron chốt phạt sau hai giờ.
  - Cron nhắc thiếu ảnh.
  - Thông báo lịch khách khẩn cấp.
  - Cron lịch khách 20:02.
  - Cron tổng kết 22:00.
  - Cron lịch khách đến giờ.
  - API /api/upload-proof.
  - API /api/bot/submit-report.
  - Các callback cập nhật/hủy lịch khách.

  ### 3. Sửa ngay đường gửi ảnh có nguy cơ cao

  Route /api/upload-proof hiện có thể lấy trực tiếp customer_appointments.group_id hoặc nhóm đầu tiên trong schedule_notification_groups.

  Cần:

  - Kiểm tra getGroupRole(targetGroup) === 'report' trước khi gửi.
  - Khi dùng fallback, query phải join telegram_groups.
  - Không dùng LIMIT 1 trên danh sách chưa lọc.
  - Nếu không tìm thấy nhóm report hợp lệ thì chỉ lưu ảnh, không gửi Telegram.

  ### 4. Chuẩn hóa toàn bộ truy vấn lấy nhóm report

  Mọi truy vấn lấy danh sách nhóm report phải có đủ:

  WHERE tg.bot_role = 'report'
    AND tg.is_active = true
    AND COALESCE(tg.is_deleted, false) = false

  Với cron nhắc KPI, bổ sung thêm:

  AND COALESCE(gs.auto_reminder_enabled, true) = true

  Áp dụng tương tự cho các truy vấn từ schedule_notification_groups.

  ### 5. Bảo vệ chiều ngược lại cho nhóm timekeep

  Trong apps/bot/timekeep_bot.js, các thông báo sau phải dùng helper với:

  requiredRole = 'timekeep'

  Bao gồm:

  - Nhắc check-in trước ca.
  - Thông báo đi muộn.
  - Gửi video check-in vào nhóm.
  - Gửi đơn xin nghỉ/đi muộn.
  - Các thông báo lịch ca làm việc.

  Như vậy nhóm report cũng không thể nhận nhầm nội dung chấm công.

  ### 6. Dọn dữ liệu nhóm nhận thông báo cũ

  Kiểm tra các bản ghi sai:

  SELECT
      s.group_id,
      tg.group_name,
      tg.bot_role,
      tg.is_active,
      tg.is_deleted
  FROM schedule_notification_groups s
  LEFT JOIN telegram_groups tg
      ON tg.telegram_group_id = s.group_id
  WHERE tg.telegram_group_id IS NULL
     OR tg.bot_role <> 'report'
     OR tg.is_active = false
     OR COALESCE(tg.is_deleted, false) = true;

  Xóa các mapping không còn hợp lệ sau khi sao lưu.

  ### 7. Thêm log kiểm toán

  Mọi tin tự động nên log:

  [Telegram Send]
  source=kpi_daily_reminder
  group_id=-123456
  required_role=report
  actual_role=report
  status=sent|blocked|failed

  Không log token Telegram hoặc nội dung nhạy cảm.

  ### 8. Kiểm thử bắt buộc

  Tạo tối thiểu bốn nhóm giả lập:

  - Nhóm report, active.
  - Nhóm timekeep, active.
  - Nhóm report, inactive.
  - Nhóm report, đã xóa.

  Ma trận kiểm thử:

   Chức năng         report    timekeep    inactive/deleted
  ━━━━━━━━━━━━━━━━  ━━━━━━━━  ━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━
   Nhắc KPI             Gửi        Chặn                Chặn
  ────────────────  ────────  ──────────  ──────────────────
   Chốt phạt KPI        Gửi        Chặn                Chặn
  ────────────────  ────────  ──────────  ──────────────────
   Nhắc thiếu ảnh       Gửi        Chặn                Chặn
  ────────────────  ────────  ──────────  ──────────────────
   Lịch khách           Gửi        Chặn                Chặn
  ────────────────  ────────  ──────────  ──────────────────
   Ảnh chứng thực       Gửi        Chặn                Chặn
  ────────────────  ────────  ──────────  ──────────────────
   Nhắc check-in       Chặn         Gửi                Chặn
  ────────────────  ────────  ──────────  ──────────────────
   Báo đi muộn         Chặn         Gửi                Chặn

  Ngoài ra kiểm tra auto_reminder_enabled = false phải chặn nhắc KPI.

  ### 9. Triển khai an toàn

  Thứ tự triển khai:

  1. Backup database.
  2. Dọn mapping sai.
  3. Deploy helper role guard.
  4. Deploy các thay đổi trong kpi_features.js và timekeep_bot.js.
  5. Chạy kiểm tra cú pháp.
  6. Restart timekeep-bot.
  7. Theo dõi log ít nhất qua một chu kỳ cron.
  8. Test thủ công bằng giờ nhắc cách hiện tại 2–3 phút.

  Tiêu chí hoàn thành: không còn lệnh gửi tự động nào vào group ID mà không đi qua kiểm tra role ngay trước thao tác Telegram API.