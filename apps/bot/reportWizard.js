import { Scenes, Markup } from 'telegraf';

// Tạo một kịch bản (Wizard) gồm 3 bước để thu thập báo cáo
export const reportWizard = new Scenes.WizardScene(
    'REPORT_WIZARD',
    
    // Bước 1: Hỏi số tin nhắn
    async (ctx) => {
        await ctx.reply(
            '📝 BẮT ĐẦU ĐIỀN BÁO CÁO\n\n👉 B1: Vui lòng nhập số **TIN NHẮN** gửi được hôm nay (ví dụ: 50):',
            Markup.keyboard([['❌ Hủy báo cáo']]).resize().oneTime()
        );
        return ctx.wizard.next();
    },
    
    // Bước 2: Xử lý tin nhắn, Hỏi Doanh thu
    async (ctx) => {
        if (ctx.message.text === '❌ Hủy báo cáo') {
            await ctx.reply('Đã hủy quá trình điền báo cáo.', Markup.removeKeyboard());
            return ctx.scene.leave();
        }

        const tinNhan = parseInt(ctx.message.text);
        if (isNaN(tinNhan) || tinNhan < 0) {
            await ctx.reply('❌ Số tin nhắn phải là một con số hợp lệ. Vui lòng nhập lại số tin nhắn:');
            return; // Ở lại bước này
        }

        // Lưu vào bộ nhớ nháp (session)
        ctx.wizard.state.tinNhan = tinNhan;

        await ctx.reply(
            `✅ Đã ghi nhận số tin nhắn: ${tinNhan}.\n\n👉 B2: Vui lòng nhập **DOANH THU** tạo ra hôm nay (Ví dụ: 12tr, 500k, hoặc nhập 0 nếu không có):`,
            Markup.keyboard([['0', '❌ Hủy báo cáo']]).resize().oneTime()
        );
        return ctx.wizard.next();
    },
    
    // Bước 3: Xử lý Doanh thu, Hỏi Lịch Khách
    async (ctx) => {
        if (ctx.message.text === '❌ Hủy báo cáo') {
            await ctx.reply('Đã hủy quá trình điền báo cáo.', Markup.removeKeyboard());
            return ctx.scene.leave();
        }

        const text = ctx.message.text.trim();
        // Giả lập lưu lại dạng raw
        ctx.wizard.state.doanhThu = text;

        await ctx.reply(
            `✅ Đã ghi nhận doanh thu: ${text}.\n\n👉 B3: Vui lòng điền **LỊCH KHÁCH HẸN**.\n(Nếu có nhiều khách, bạn có thể copy/paste danh sách. Nếu không có khách, vui lòng nhập "0"):`,
            Markup.keyboard([['0', '❌ Hủy báo cáo']]).resize().oneTime()
        );
        return ctx.wizard.next();
    },

    // Bước 4: Xử lý Lịch khách và Tổng hợp thành Form Chuẩn
    async (ctx) => {
        if (ctx.message.text === '❌ Hủy báo cáo') {
            await ctx.reply('Đã hủy quá trình điền báo cáo.', Markup.removeKeyboard());
            return ctx.scene.leave();
        }

        const lichKhach = ctx.message.text.trim();
        const state = ctx.wizard.state;

        // Tạo ra đoạn text báo cáo chuẩn form 100% để nhét vào hệ thống cũ
        const finalReportText = 
`#baocao
Số tin nhắn: ${state.tinNhan}
Doanh thu: ${state.doanhThu}
Lịch khách:
${lichKhach}`;

        // Ảo thuật: Giả vờ như user vừa gõ đúng cái form chuẩn 100% này vào chat
        ctx.message.text = finalReportText;
        
        await ctx.reply('🎉 Cảm ơn bạn! Đã nhận đủ thông tin. Hệ thống đang tiến hành nộp báo cáo chuẩn form cho bạn...', Markup.removeKeyboard());

        // Sau đó ta sẽ pass ctx này sang hàm xử lý báo cáo cũ (sẽ làm ở bước sau)
        // Hiện tại chỉ in ra màn hình để test:
        await ctx.reply(`📋 Báo cáo của bạn được tổng hợp tự động như sau:\n\n${finalReportText}`);

        return ctx.scene.leave();
    }
);
