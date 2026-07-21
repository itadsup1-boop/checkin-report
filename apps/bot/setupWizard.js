import { Scenes, Markup } from 'telegraf';

// Tạo một kịch bản (Wizard) để đăng ký tài khoản
export const setupWizard = new Scenes.WizardScene(
    'SETUP_WIZARD',
    
    // Bước 1: Hỏi Tên
    async (ctx) => {
        await ctx.reply(
            `👤 BẮT ĐẦU ĐĂNG KÝ TÀI KHOẢN\n\n👉 @${ctx.from.username || ctx.from.first_name}, Vui lòng nhập **Họ và Tên** của bạn (Ví dụ: Nguyễn Văn Hùng):`,
            Markup.forceReply().selective(true)
        );
        return ctx.wizard.next();
    },
    
    // Bước 2: Xử lý Tên và gọi lệnh setup ảo
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) return;
        
        const textLower = ctx.message.text.trim().toLowerCase();
        if (textLower === 'hủy' || textLower === 'huy' || textLower === '❌ hủy đăng ký') {
            await ctx.reply('Đã hủy quá trình đăng ký.');
            return ctx.scene.leave();
        }

        const fullName = ctx.message.text.trim();
        if (fullName.length < 2) {
            await ctx.reply('❌ Tên quá ngắn. Vui lòng nhập đầy đủ Họ và Tên:');
            return; // Ở lại bước này
        }

        const telegramId = ctx.from.id.toString();
        const username = ctx.from.username || '';
        const chat = ctx.chat;
        const groupId = chat.type !== 'private' ? chat.id.toString() : null;

        try {
            // Cố gắng tìm bằng telegram_id trước
            const pool = (await import('../../packages/database/index.js')).default;
            let res = await pool.query('SELECT * FROM employees WHERE telegram_id = $1', [telegramId]);
            
            if (res.rows.length === 0) {
                res = await pool.query('SELECT * FROM employees WHERE full_name ILIKE $1', [fullName]);
            }

            if (groupId) {
                await pool.query(
                    `INSERT INTO telegram_groups (telegram_group_id, group_name) VALUES ($1, $2) ON CONFLICT (telegram_group_id) DO UPDATE SET group_name = EXCLUDED.group_name`,
                    [groupId, chat.title || 'Group KPI']
                );
            }

            if (res.rows.length > 0) {
                const empId = res.rows[0].id;
                const currentKpi = parseFloat(res.rows[0].current_kpi_target);
                const newKpi = (!currentKpi || currentKpi === 0) ? 40 : currentKpi;

                if (groupId) {
                    await pool.query('UPDATE employees SET telegram_id = $1, telegram_username = $2, full_name = $3, current_kpi_target = $4, telegram_group_id = $5 WHERE id = $6', [telegramId, username, fullName, newKpi, groupId, empId]);
                } else {
                    await pool.query('UPDATE employees SET telegram_id = $1, telegram_username = $2, full_name = $3, current_kpi_target = $4 WHERE id = $5', [telegramId, username, fullName, newKpi, empId]);
                }
                
                await ctx.reply(`✅ Cập nhật thành công! Đã kết nối với nhân viên: ${fullName}\n🎯 Chỉ tiêu hiện tại của bạn: ${newKpi}`);
            } else {
                const tempEmpCode = `NV_${telegramId.slice(-4)}`;
                await pool.query(
                    `INSERT INTO employees (full_name, employee_code, department, position, telegram_id, telegram_username, current_kpi_target, telegram_group_id) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [fullName, tempEmpCode, 'Sales', 'Telesale', telegramId, username, 40, groupId]
                );
                await ctx.reply(`✅ Đăng ký thành công! Đã thêm nhân viên mới: ${fullName}\n🎯 Chỉ tiêu KPI mặc định: 40\nBây giờ bạn có thể dùng lệnh báo cáo.`);
            }
        } catch (err) {
            console.error("Lỗi đăng ký NV Wizard:", err);
            await ctx.reply("❌ Lỗi khi đăng ký: " + err.message);
        }

        return ctx.scene.leave();
    }
);
