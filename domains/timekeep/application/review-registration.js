import { SELF_REGISTER_ROLES } from '../domain/timekeep-rules.js';

function canManageGroup(auth, telegramGroupId) {
    return auth.isSuperAdmin || (auth.allowedGroupIds || []).map(String).includes(String(telegramGroupId));
}

export function createReviewRegistrationService({
    pool,
    repository,
    kpiGroupRoles,
    registerInKpiGroup
}) {
    async function listPending(auth, groupId, status = 'ALL') {
        if (!auth.isSuperAdmin && groupId && groupId !== 'ALL' && !canManageGroup(auth, groupId)) {
            return { ok: false, status: 403, message: 'Bạn không có quyền xem yêu cầu của nhóm này.' };
        }
        const normalizedStatus = String(status || 'ALL').toUpperCase();
        if (!['ALL', 'PENDING', 'ACTIVE', 'REJECTED'].includes(normalizedStatus)) {
            return { ok: false, status: 400, message: 'Trạng thái đăng ký không hợp lệ.' };
        }
        const requests = await repository.listRequests({ ...auth, groupId, status: normalizedStatus });
        return { ok: true, requests };
    }

    async function approve({ requestId, targetEmployeeId, auth, reviewedBy }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const request = await repository.lockPending(client, requestId);
            if (!request) {
                await client.query('ROLLBACK');
                return { ok: false, status: 404, message: 'Yêu cầu không tồn tại hoặc đã được xử lý.' };
            }

            const telegramGroupId = request.telegram_group_id;
            if (!canManageGroup(auth, telegramGroupId)) {
                await client.query('ROLLBACK');
                return { ok: false, status: 403, message: 'Bạn không có quyền duyệt yêu cầu của nhóm này.' };
            }
            if (!SELF_REGISTER_ROLES.includes(request.requested_role)) {
                await client.query('ROLLBACK');
                return { ok: false, status: 400, message: 'Vai trò yêu cầu không hợp lệ; hãy từ chối yêu cầu này.' };
            }

            const targetId = targetEmployeeId || request.suggested_employee_id;
            const target = await repository.lockTarget(client, targetId);
            if (!target || String(target.group_id) !== String(request.group_id)) {
                await client.query('ROLLBACK');
                return { ok: false, status: 400, message: 'Hồ sơ được chọn không thuộc đúng nhóm.' };
            }
            if (target.telegram_id) {
                await client.query('ROLLBACK');
                return { ok: false, status: 409, message: 'Hồ sơ được chọn đã liên kết với một Telegram khác.' };
            }
            if (target.pending_telegram_id && String(target.id) !== String(request.suggested_employee_id)) {
                await client.query('ROLLBACK');
                return { ok: false, status: 409, message: 'Hồ sơ được chọn đang có một yêu cầu khác chờ duyệt.' };
            }

            const isKpiGroup = kpiGroupRoles.includes(request.bot_role);
            const conflict = await repository.findTelegramConflict(client, {
                telegramId: request.telegram_id,
                groupId: request.group_id,
                isKpiGroup,
                excludedIds: [request.suggested_employee_id, target.id]
            });
            if (conflict) {
                await client.query('ROLLBACK');
                return { ok: false, status: 409, message: 'Telegram này đã được liên kết với một hồ sơ khác.' };
            }

            const employee = await repository.approveTarget(client, target.id, request, { isKpiGroup });
            if (isKpiGroup) {
                const membership = await registerInKpiGroup(
                    client,
                    employee,
                    telegramGroupId,
                    `admin_registration_approval`
                );
                if (!membership.ok) {
                    await client.query('ROLLBACK');
                    return { ok: false, status: 400, message: 'Nhóm KPI không còn hoạt động.' };
                }
            }

            await repository.markActive(client, request.id, target.id, reviewedBy);
            await repository.clearOrDeleteSource(client, request, target.id);
            await client.query('COMMIT');
            return { ok: true, employee };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async function reject({ requestId, auth, reviewedBy, reason }) {
        const rejectionReason = String(reason || '').trim();
        if (!rejectionReason) {
            return { ok: false, status: 400, message: 'Vui lòng nhập lý do từ chối.' };
        }
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const request = await repository.lockPending(client, requestId);
            if (!request) {
                await client.query('ROLLBACK');
                return { ok: false, status: 404, message: 'Yêu cầu không tồn tại hoặc đã được xử lý.' };
            }

            const telegramGroupId = request.telegram_group_id;
            if (!canManageGroup(auth, telegramGroupId)) {
                await client.query('ROLLBACK');
                return { ok: false, status: 403, message: 'Bạn không có quyền từ chối yêu cầu của nhóm này.' };
            }

            await repository.markRejected(client, request.id, reviewedBy, rejectionReason);
            await repository.clearOrDeleteSource(client, request);
            await client.query('COMMIT');
            return { ok: true };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    return { listPending, approve, reject };
}
