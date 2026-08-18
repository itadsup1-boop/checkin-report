/**
 * Use case: nhân sự tự đăng ký tài khoản từ Mini App.
 *
 * Có HAI đường đi khác hẳn nhau, tuỳ vai trò của nhóm:
 *
 *   Nhóm KPI  — một tài khoản nhân viên dùng chung toàn hệ thống, mỗi nhóm là một
 *               "membership" riêng. Đăng ký lại ở nhóm khác KHÔNG tạo bản sao.
 *               Chạy trong transaction + FOR UPDATE để hai lần bấm cùng lúc không
 *               sinh hai hồ sơ.
 *
 *   Nhóm khác — mỗi nhóm một hồ sơ riêng. Đã đăng ký rồi thì từ chối.
 */

import { TimekeepError, buildEmployeeCode, checkRegistrationInput } from '../domain/timekeep-rules.js';

export function createRegisterEmployeeService({ pool, repository, kpiGroupRoles, registerInKpiGroup }) {
    /** Nhóm chưa có trong bảng thì tạo — nhân sự không phải chờ Admin khai báo trước. */
    async function resolveGroup(telegramGroupId) {
        const existing = await repository.findGroup(telegramGroupId);
        return existing || repository.createGroup(telegramGroupId);
    }

    async function registerInKpiFlow({ groupId, telegramGroupId, data }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let employee = await repository.lockGlobalEmployee(client, data.telegramId)
                || await repository.lockUnlinkedByName(client, groupId, data.fullName);

            if (employee) {
                employee = await repository.attachTelegramToEmployee(client, employee.id, data);
            } else {
                employee = await repository.insertKpiEmployee(client, groupId, {
                    ...data,
                    employeeCode: buildEmployeeCode(data.telegramId)
                });
            }

            const registration = await registerInKpiGroup(client, employee, telegramGroupId, 'mini_app_registration');
            if (!registration.ok) {
                await client.query('ROLLBACK');
                return { ok: false, status: 400, message: 'Nhóm này không phải nhóm KPI đang hoạt động.' };
            }

            await client.query('COMMIT');
            return { ok: true, message: 'Đăng ký hoạt động KPI trong nhóm thành công!' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    return async function registerEmployee(input) {
        const data = {
            telegramId: input.telegramId,
            telegramUsername: input.telegramUsername,
            fullName: input.fullName,
            role: input.role,
            telegramGroupId: input.telegramGroupId
        };

        const check = checkRegistrationInput(data);
        if (!check.ok) throw new TimekeepError(check.message, 400);

        console.log(`[Registration] Nhận yêu cầu đăng ký: ID=${data.telegramId}, Name=${data.fullName}, Role=${data.role}, GroupID=${data.telegramGroupId}`);

        const group = await resolveGroup(data.telegramGroupId);

        if (kpiGroupRoles.includes(group.bot_role)) {
            return registerInKpiFlow({ groupId: group.id, telegramGroupId: data.telegramGroupId, data });
        }

        const existing = await repository.findByTelegramIdInGroup(group.id, data.telegramId);
        if (existing) {
            console.log(`[Registration] Người dùng đã tồn tại trong nhóm, từ chối đăng ký lại. telegram_id=${data.telegramId}, group_id=${group.id}`);
            return { ok: false, status: 400, message: 'Người dùng đã đăng ký trong nhóm này.' };
        }

        // Ưu tiên gắn vào hồ sơ Admin đã tạo sẵn, tránh tách đôi dữ liệu một người.
        const unlinked = await repository.findUnlinkedByName(group.id, data.fullName);
        if (unlinked) {
            await repository.linkExisting(unlinked.id, data);
        } else {
            await repository.insertEmployee(group.id, {
                ...data,
                employeeCode: buildEmployeeCode(data.telegramId)
            });
        }

        console.log(`[Registration] Thêm mới thành công user: ${data.fullName}`);
        return { ok: true, message: 'Đăng ký tài khoản thành công!' };
    };
}
