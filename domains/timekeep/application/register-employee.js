/**
 * Use case: nhân sự gửi yêu cầu đăng ký tài khoản từ Mini App.
 *
 * Tài khoản Telegram đã được xác minh trước đó có thể đăng ký thêm nhóm KPI.
 * Mọi tài khoản mới chỉ tạo yêu cầu chờ Admin duyệt; tên chỉ là dữ liệu gợi ý,
 * tuyệt đối không tự động gắn Telegram vào hồ sơ nhân viên cùng tên.
 */

import { TimekeepError, buildEmployeeCode, checkRegistrationInput } from '../domain/timekeep-rules.js';

export function createRegisterEmployeeService({ pool, repository, kpiGroupRoles, registerInKpiGroup }) {
    const pendingOutcome = {
        ok: true,
        pending: true,
        message: 'Đã gửi yêu cầu đăng ký. Vui lòng chờ Admin xác nhận đúng hồ sơ nhân viên.'
    };

    async function resolveGroup(telegramGroupId) {
        const existing = await repository.findGroup(telegramGroupId);
        return existing || repository.createGroup(telegramGroupId);
    }

    async function queuePendingRegistration(client, { groupId, data, isKpiGroup }) {
        const existingPending = await repository.lockPendingByTelegramInGroup(
            client,
            data.telegramId,
            data.telegramGroupId
        );
        if (existingPending) return pendingOutcome;

        // Tên chỉ dùng để gợi ý hồ sơ cho Admin; bước này không gắn Telegram ID.
        const suggestedProfile = await repository.lockUnlinkedByName(client, groupId, data.fullName);
        if (suggestedProfile) {
            const queued = await repository.setPendingRegistration(client, suggestedProfile.id, data);
            if (queued) {
                await repository.createRegistrationRequest(client, queued, data, { isNewProfile: false });
                return pendingOutcome;
            }
        }

        const pendingEmployee = await repository.insertPendingEmployee(client, groupId, {
            ...data,
            employeeCode: buildEmployeeCode(data.telegramId)
        }, { isKpiGroup });
        await repository.createRegistrationRequest(client, pendingEmployee, data, { isNewProfile: true });
        return pendingOutcome;
    }

    async function registerInKpiFlow({ groupId, telegramGroupId, data }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Đã xác minh bằng chính Telegram ID trước đó: chỉ thêm membership nhóm KPI.
            const employee = await repository.lockGlobalEmployee(client, data.telegramId);
            if (!employee) {
                const outcome = await queuePendingRegistration(client, { groupId, data, isKpiGroup: true });
                await client.query('COMMIT');
                return outcome;
            }

            const registration = await registerInKpiGroup(client, employee, telegramGroupId, 'mini_app_registration');
            if (!registration.ok) {
                await client.query('ROLLBACK');
                return { ok: false, status: 400, message: 'Nhóm này không phải nhóm KPI đang hoạt động.' };
            }

            await client.query('COMMIT');
            return { ok: true, pending: false, message: 'Đăng ký hoạt động KPI trong nhóm thành công!' };
        } catch (error) {
            await client.query('ROLLBACK');
            // Hai lần gửi đồng thời cùng Telegram/nhóm đều được coi là cùng một yêu cầu.
            if (error.code === '23505') return pendingOutcome;
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

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const existing = await repository.lockByTelegramIdInGroup(client, group.id, data.telegramId);
            if (existing) {
                await client.query('ROLLBACK');
                return { ok: false, status: 400, message: 'Người dùng đã đăng ký trong nhóm này.' };
            }

            const outcome = await queuePendingRegistration(client, { groupId: group.id, data, isKpiGroup: false });
            await client.query('COMMIT');
            console.log(`[Registration] Đã tạo yêu cầu chờ Admin duyệt: ${data.fullName}`);
            return outcome;
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') return pendingOutcome;
            throw error;
        } finally {
            client.release();
        }
    };
}
