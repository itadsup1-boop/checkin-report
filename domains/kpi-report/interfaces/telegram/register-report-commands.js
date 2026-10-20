/**
 * Lệnh cấu hình báo cáo KPI của Admin/Sếp: giờ nhắc, mức phạt, chỉ tiêu, lịch
 * chốt, và lệnh kích hoạt riêng cho nhóm.
 */

import { parseCurrency } from '../../domain/report-parsing.js';

export function registerReportCommands({ kpiComposer, groupConfigRepository, reportRepository, checkAdmin }) {
    // Lệnh thay đổi giờ nhắc nhở: /hengio 17:30
    kpiComposer.command('hengio', async ctx => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        if (chat.type === 'private') {
            return ctx.reply('Lệnh này chỉ dùng trong Group chat.');
        }

        const text = ctx.message.text;
        const match = text.match(/\/hengio\s+(\d{1,2}:\d{2})/);
        if (!match) {
            return ctx.reply('❌ Cú pháp sai. Vui lòng nhập: /hengio HH:MM\nVí dụ: /hengio 17:30');
        }

        const timeString = match[1] + ':00';
        try {
            await groupConfigRepository.setRemindTime(chat.id.toString(), timeString);
            ctx.reply(`✅ Đã thay đổi giờ nhắc báo cáo thành ${match[1]} hàng ngày!`);
        } catch (err) {
            console.error('Lỗi đổi giờ:', err);
            ctx.reply('❌ Lỗi khi thay đổi giờ: ' + err.message);
        }
    });

    // Lệnh thiết lập mức phạt chung: /phatvipham 100k
    kpiComposer.command('phatvipham', async ctx => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        const text = ctx.message.text.replace(/\/phatvipham/i, '').trim().toLowerCase();

        if (chat.type === 'private') {
            return ctx.reply('❌ Lệnh này chỉ dùng được khi add Bot vào trong một Nhóm chat.');
        }
        if (!text) {
            return ctx.reply('❌ Cú pháp sai. Vui lòng gõ: /phatvipham <số tiền>\nVí dụ: /phatvipham 100k');
        }

        const amount = parseCurrency(text);
        if (amount <= 0 && text !== '0') {
            return ctx.reply('❌ Số tiền không hợp lệ. Vui lòng gõ: /phatvipham 100k hoặc /phatvipham 0 để tắt phạt.');
        }

        try {
            await groupConfigRepository.setPenaltyMissingKpi(chat.id.toString(), amount);
            if (amount === 0) {
                ctx.reply(`✅ Đã tắt chế độ phạt vi phạm trong nhóm này.`);
            } else {
                ctx.reply(`✅ Đã thiết lập mức phạt vi phạm (Thiếu KPI, Nợ Ảnh)!\nTừ bây giờ, nhân viên vi phạm lỗi này sẽ bị phạt: -${amount.toLocaleString('vi-VN')}đ (Tối đa 1 lần phạt/ngày).`);
            }
        } catch (err) {
            console.error('Lỗi cài đặt phạt:', err);
            ctx.reply('❌ Lỗi hệ thống: ' + err.message);
        }
    });

    // Lệnh thiết lập phạt không báo cáo: /phatbaocao 500k
    kpiComposer.command('phatbaocao', async ctx => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        const text = ctx.message.text.replace('/phatbaocao', '').trim().toLowerCase();

        if (chat.type === 'private') {
            return ctx.reply('❌ Lệnh này chỉ dùng được trong Nhóm.');
        }
        if (!text) {
            return ctx.reply('❌ Cú pháp sai. Vui lòng gõ: /phatbaocao <số tiền>\nVí dụ: /phatbaocao 500k');
        }

        const amount = parseCurrency(text);
        if (amount <= 0 && text !== '0') {
            return ctx.reply('❌ Số tiền không hợp lệ.');
        }

        try {
            await groupConfigRepository.setPenaltyMissingReport(chat.id.toString(), amount);
            if (amount === 0) {
                ctx.reply(`✅ Đã tắt chế độ phạt không nộp báo cáo.`);
            } else {
                ctx.reply(`✅ Đã thiết lập mức phạt KHÔNG NỘP BÁO CÁO: -${amount.toLocaleString('vi-VN')}đ.`);
            }
        } catch (err) {
            console.error('Lỗi cài đặt phạt báo cáo:', err);
            ctx.reply('❌ Lỗi hệ thống: ' + err.message);
        }
    });

    // Lệnh thiết lập KPI: /kpi 10
    kpiComposer.command('kpi', async ctx => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        const text = ctx.message.text.replace(/\/kpi/i, '').trim();

        if (chat.type === 'private') {
            return ctx.reply('❌ Lệnh này chỉ dùng được trong Nhóm.');
        }

        const newKpi = parseInt(text);
        if (isNaN(newKpi) || newKpi <= 0) {
            return ctx.reply('❌ Cú pháp sai. Vui lòng gõ: /kpi <số lượng>\nVí dụ: /kpi 40');
        }

        try {
            const groupId = chat.id.toString();
            const updatedCount = await reportRepository.setKpiTargetForGroup(groupId, newKpi, `telegram:${ctx.from.id}`);

            if (newKpi === 0) {
                await reportRepository.deletePendingReportsForGroup(groupId);
            }

            ctx.reply(`🎯 Đã cập nhật chỉ tiêu KPI chung cho nhóm là: ${newKpi} tin nhắn/ngày!\n(Đã áp dụng cho ${updatedCount} nhân viên trong nhóm)`);
        } catch (err) {
            console.error('Lỗi cài đặt KPI:', err);
            ctx.reply('❌ Có lỗi xảy ra: ' + err.message);
        }
    });

    // Lệnh thiết lập lịch chốt báo cáo: /lichbaocao 18:00 hoặc 18h
    kpiComposer.command('lichbaocao', async ctx => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        const text = ctx.message.text.replace('/lichbaocao', '').trim();

        if (chat.type === 'private') return ctx.reply('Lệnh này chỉ dùng trong Group.');
        if (!text) return ctx.reply('❌ Vui lòng nhập giờ. VD: /lichbaocao 18:00');

        const match = text.match(/(\d{1,2})[h:](\d{2})?/i);
        if (!match) {
            return ctx.reply('❌ Giờ không hợp lệ. VD: 18:30 hoặc 18h');
        }
        const h = match[1].padStart(2, '0');
        const m = (match[2] || '00').padStart(2, '0');
        const timeString = `${h}:${m}:00`;

        try {
            await groupConfigRepository.setDeadlineTime(chat.id.toString(), timeString);
            ctx.reply(`✅ Đã chốt Lịch Nộp Báo Cáo là ${timeString} hàng ngày!\nĐến giờ này Bot sẽ điểm danh những ai chưa nộp.\nSau 2 tiếng (tức ${timeString.slice(0, 5)} + 2 tiếng) sẽ chốt sổ phạt!`);
        } catch (err) {
            ctx.reply('❌ Lỗi hệ thống: ' + err.message);
        }
    });

    // Lệnh tạo quy trình mới cho Nhóm (Gắn lệnh báo cáo)
    kpiComposer.command('taocaulenh', async ctx => {
        if (!checkAdmin(ctx)) return;
        const chat = ctx.chat;
        const text = ctx.message.text.replace('/taocaulenh', '').trim().toLowerCase();

        if (chat.type === 'private') {
            return ctx.reply('❌ Lệnh này chỉ dùng được khi add Bot vào trong một Nhóm chat.');
        }
        if (!text.startsWith('#') || text.length < 2) {
            return ctx.reply('❌ Cú pháp sai. Vui lòng gõ theo định dạng: /taocaulenh #ten_lenh\nVí dụ: /taocaulenh #doanhthu');
        }

        try {
            await groupConfigRepository.setWorkflowTrigger(chat.id.toString(), chat.title || 'Nhóm KPI', text);
            return ctx.reply(`✅ Khởi tạo thành công!\nTừ bây giờ, nhân viên trong nhóm này sẽ dùng lệnh \`${text}\` để báo cáo.\n\nSếp vui lòng lên Web Admin để cấu hình thêm tính năng (như: Bắt gửi ảnh, tính doanh thu...) cho nhóm này nhé!`);
        } catch (err) {
            console.error('Lỗi tạo câu lệnh nhóm:', err);
            return ctx.reply('❌ Có lỗi xảy ra khi lưu cấu hình nhóm: ' + err.message);
        }
    });
}
