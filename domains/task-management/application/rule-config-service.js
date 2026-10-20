// Rule config theo từng quản lý (mục 29): ngưỡng nhắc cấu hình được, nút tạm
// dừng automation của riêng mình. Mọi giá trị đều deterministic, không AI.

export const RULE_DEFAULTS = {
    due_soon_minutes: 30,
    not_accepted_minutes: 15,
    overdue_manager_hours: 2,
    form_due_soon_hours: 24,
    form_overdue_manager_hours: 2,
    paused: false
};

// Dải cho phép trùng CHECK constraint của migration v63 — chặn sớm ở service
// để trả lời lỗi tiếng Việt thay vì lỗi DB.
export const RULE_RANGES = {
    due_soon_minutes: { min: 5, max: 720, label: 'nhắc trước hạn (phút)' },
    not_accepted_minutes: { min: 5, max: 120, label: 'nhắc khi chưa nhận việc (phút)' },
    overdue_manager_hours: { min: 1, max: 72, label: 'báo người giao khi quá hạn (giờ)' },
    form_due_soon_hours: { min: 1, max: 168, label: 'nhắc form trước hạn (giờ)' },
    form_overdue_manager_hours: { min: 1, max: 72, label: 'báo người giao khi form quá hạn (giờ)' }
};

// Cửa sổ lấy dữ liệu khi post-filter: query với biên bao phủ mọi config hợp lệ
// rồi lọc từng dòng theo ngưỡng của người giao. "chưa nhận" là ngưỡng TỐI THIỂU
// (assigned_at <= now - X) nên fetch bằng min; "sắp đến hạn" là ngưỡng TỐI ĐA
// (due_at <= now + X) nên fetch bằng max.
export const FETCH_WINDOW = {
    minutesMin: 5,
    minutesMax: 720,
    hoursMax: 168
};

export const RULE_FIELD_ALIASES = {
    due: 'due_soon_minutes', 'truochạn': 'due_soon_minutes', 'truoc_han': 'due_soon_minutes',
    nhan: 'not_accepted_minutes', 'chuanhan': 'not_accepted_minutes', 'chua_nhan': 'not_accepted_minutes',
    tre: 'overdue_manager_hours', 'quahan': 'overdue_manager_hours', 'trengiao': 'overdue_manager_hours',
    formdue: 'form_due_soon_hours', 'formtruoc': 'form_due_soon_hours',
    formtre: 'form_overdue_manager_hours', 'formquahan': 'form_overdue_manager_hours'
};

function fail(code, message) {
    throw Object.assign(new Error(message), { code });
}

function withDefaults(row) {
    return { ...RULE_DEFAULTS, ...(row || {}) };
}

// Trường cấu hình (cột DB) -> key camelCase mà repository upsert nhận
const FIELD_TO_UPSERT = {
    due_soon_minutes: 'dueSoonMinutes',
    not_accepted_minutes: 'notAcceptedMinutes',
    overdue_manager_hours: 'overdueManagerHours',
    form_due_soon_hours: 'formDueSoonHours',
    form_overdue_manager_hours: 'formOverdueManagerHours'
};

export function createRuleConfigService({ ruleConfigRepository, now = () => new Date() }) {
    // Load 1 lần mỗi tick: Map managerId -> config (điền mặc định nếu chưa có)
    async function loadConfigsForTick(managerIds) {
        const unique = [...new Set(managerIds.filter(Boolean).map(String))];
        if (!unique.length) return new Map();
        const rows = await ruleConfigRepository.getRuleConfigsForManagers(unique);
        const map = new Map();
        for (const id of unique) map.set(String(id), withDefaults(null));
        for (const row of rows) map.set(String(row.manager_id), withDefaults(row));
        return map;
    }

    function shouldSkip(config) {
        return !config || config.paused;
    }

    function isOverdueManagerDue(config, dueAt, nowMs) {
        return nowMs - new Date(dueAt).getTime() >= config.overdue_manager_hours * 3600 * 1000;
    }

    function isFormOverdueManagerDue(config, dueAt, nowMs) {
        return nowMs - new Date(dueAt).getTime() >= config.form_overdue_manager_hours * 3600 * 1000;
    }

    function isDueSoonWithin(config, dueAt, nowMs) {
        return new Date(dueAt).getTime() - nowMs <= config.due_soon_minutes * 60 * 1000;
    }

    function isFormDueSoonWithin(config, dueAt, nowMs) {
        return new Date(dueAt).getTime() - nowMs <= config.form_due_soon_hours * 3600 * 1000;
    }

    function isNotAcceptedLateEnough(config, assignedAt, nowMs) {
        return nowMs - new Date(assignedAt).getTime() >= config.not_accepted_minutes * 60 * 1000;
    }

    function normalizeFieldKey(input) {
        const key = String(input).trim().toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
        return RULE_FIELD_ALIASES[key] || null;
    }

    // Cho handlers hiện nhãn trường chuẩn từ từ khóa người dùng gõ
    function resolveRuleField(rawKey) {
        return normalizeFieldKey(rawKey);
    }

    async function applyRuleConfig(managerId, rawKey, rawValue) {
        const field = normalizeFieldKey(rawKey);
        if (!field) {
            fail('UNKNOWN_FIELD', `Không rõ trường "${rawKey}". Dùng: due, nhan, tre, formdue, formtre.`);
        }
        const value = Number(String(rawValue).trim());
        const range = RULE_RANGES[field];
        if (!Number.isInteger(value) || value < range.min || value > range.max) {
            fail('VALUE_OUT_OF_RANGE', `${range.label} phải là số nguyên ${range.min}–${range.max}.`);
        }
        const updated = await ruleConfigRepository.upsertRuleConfig(String(managerId), {
            [FIELD_TO_UPSERT[field]]: value
        });
        return withDefaults(updated);
    }

    async function togglePaused(managerId, paused) {
        const updated = await ruleConfigRepository.setRuleConfigPaused(String(managerId), paused);
        return withDefaults(updated);
    }

    async function describeConfig(managerId) {
        const config = await getEffectiveConfig(managerId);
        // Mô phỏng theo đúng ngưỡng của người xem: đếm số lượt sẽ được nhắc
        // nếu automation chạy bây giờ với config này
        const [dueSoon, notAccepted, formsDue] = await Promise.all([
            ruleConfigRepository.countAssigneesDueWithin(config.due_soon_minutes),
            ruleConfigRepository.countAssigneesNotAcceptedPending(config.not_accepted_minutes),
            ruleConfigRepository.countFormsDueWithin(config.form_due_soon_hours)
        ]);
        const lines = [
            config.paused ? '⏸️ AUTOMATION CỦA BẠN ĐANG TẠM DỪNG (/chohay để bật lại)' : '▶️ Automation đang chạy',
            '',
            `⏰ Nhắc trước hạn: ${config.due_soon_minutes} phút (dải 5–720)`,
            `⚠️ Nhắc khi chưa nhận việc: ${config.not_accepted_minutes} phút (dải 5–120)`,
            `🔴 Báo người giao khi quá hạn: ${config.overdue_manager_hours} giờ (dải 1–72)`,
            `⏰ Nhắc form trước hạn: ${config.form_due_soon_hours} giờ (dải 1–168)`,
            `🔴 Báo người giao khi form quá hạn: ${config.form_overdue_manager_hours} giờ (dải 1–72)`,
            '',
            '📊 Mô phỏng trên dữ liệu hiện tại (cửa sổ tối đa):',
            `• ${dueSoon} lượt việc sắp đến hạn sẽ được nhắc trước`,
            `• ${notAccepted} lượt việc chưa nhận sẽ được nhắc lại`,
            `• ${formsDue} bài form sắp đến hạn sẽ được nhắc`,
            '',
            'Đổi ngưỡng: /cauhinh <trường> <số> — ví dụ /cauhinh due 45',
            'Trường: due, nhan, tre, formdue, formtre'
        ];
        return { config, text: lines.join('\n') };
    }

    async function getEffectiveConfig(managerId) {
        return withDefaults(await ruleConfigRepository.getRuleConfig(managerId));
    }

    return {
        loadConfigsForTick,
        shouldSkip,
        isOverdueManagerDue,
        isFormOverdueManagerDue,
        isDueSoonWithin,
        isFormDueSoonWithin,
        isNotAcceptedLateEnough,
        applyRuleConfig,
        resolveRuleField,
        togglePaused,
        describeConfig,
        getEffectiveConfig
    };
}
