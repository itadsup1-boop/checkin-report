import { Telegraf } from 'telegraf';
import pool from 'file:///C:/Users/ADMIN/Downloads/telegramReport/telegramReport/packages/database/index.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

async function run() {
    const employees = [
        {
            userId: 'a12c4300-8367-4ee9-b1de-c50961e845ea',
            name: 'trang',
            groupId: '7cdb911f-5e2b-441f-adc9-75a5c8793176'
        },
        {
            userId: 'daceaee2-d46c-4be9-aa21-f97047f4a4f3',
            name: 'Hà trần cẩm nhung',
            groupId: 'a65bfffc-3821-43bd-a066-7e6e155cc391'
        }
    ];

    for (const emp of employees) {
        // Find the telegram_group_id
        const groupRes = await pool.query(
            "SELECT telegram_group_id FROM telegram_groups WHERE id = $1",
            [emp.groupId]
        );
        
        if (groupRes.rows.length > 0) {
            const telegramGroupId = groupRes.rows[0].telegram_group_id;
            
            const message = `✅ <b>THÔNG BÁO CẬP NHẬT ĐIỂM DANH</b> ✅\n\n` +
                            `👤 Nhân viên: <b>${emp.name}</b>\n` +
                            `📝 Trạng thái ngày 23/08/2026: <b>Đã cập nhật thành CÓ PHÉP (OFF)</b>\n\n` +
                            `<i>(Hệ thống đã tự động gỡ bỏ ghi nhận phạt 50.000đ do vắng mặt trước đó).</i>`;
            
            await bot.telegram.sendMessage(telegramGroupId, message, { parse_mode: 'HTML' });
            console.log(`Sent notification for ${emp.name} to group ${telegramGroupId}`);
        } else {
            console.log(`Could not find telegram group for ${emp.name}`);
        }
    }
}

run().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
