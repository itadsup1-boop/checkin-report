import { buildHolidayAnnouncement, validateHolidayInput } from '../domain/holiday-policy.js';

export function createCompanyHolidayService({ repository }) {
    async function ensureNoOverlap(data, excludeId) {
        const overlap = await repository.findOverlap({ startDate: data.startDate, endDate: data.endDate, excludeId });
        if (overlap) throw new Error(`Khoảng nghỉ bị trùng với “${overlap.name}”.`);
    }
    async function create(input, adminId) {
        const data = validateHolidayInput(input);
        await ensureNoOverlap(data);
        return repository.create({ ...data, createdBy: adminId });
    }
    async function update(id, input) {
        const data = validateHolidayInput(input);
        await ensureNoOverlap(data, id);
        const holiday = await repository.update(id, data);
        if (!holiday) throw new Error('Không tìm thấy kỳ nghỉ có thể chỉnh sửa.');
        return holiday;
    }
    return {
        list: filters => repository.list(filters), create, update,
        cancel: id => repository.cancel(id),
        isHoliday: date => repository.isHoliday(date),
        preview: input => buildHolidayAnnouncement({
            ...validateHolidayInput(input), start_date: input.start_date, end_date: input.end_date || input.start_date
        })
    };
}
