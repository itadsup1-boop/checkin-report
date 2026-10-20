const DEADLINE_RE = /(?:\b(?:lúc|luc|vào|vao|trước|truoc|hạn|han|deadline)\s*)?\d{1,2}(?::\d{2}|h(?:\s*\d{1,2})?)\s*(?:sáng|sang|trưa|trua|chiều|chieu|tối|toi)?\s*(?:hôm nay|hom nay|nay|ngày mai|ngay mai|mai)?/iu;
const TASK_CODE_RE = /[A-Za-z]{2,}\d{2,}/g;
const TASK_ID_RE = /#?T-?(\d+)/i;

export function normalizeVi(value) {
    return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

function unique(values) {
    return [...new Set(values.filter(Boolean).map(value => String(value).toUpperCase()))];
}

function codeFromToken(token) {
    const uppercaseCode = String(token).match(/[A-Z]{2,}\d{2,}/g);
    if (uppercaseCode?.length) return uppercaseCode.at(-1).toUpperCase();
    const embeddedCode = String(token).match(/(?:nv|kt|ns)\d{2,}/i);
    if (embeddedCode) return embeddedCode[0].toUpperCase();
    return String(token).toUpperCase();
}

function extractCodes(text) {
    return unique([...String(text).matchAll(TASK_CODE_RE)].map(match => codeFromToken(match[0])));
}

function extractTaskId(text) {
    const match = TASK_ID_RE.exec(String(text));
    return match ? match[1] : null;
}

function extractDeadline(text) {
    const match = DEADLINE_RE.exec(String(text));
    return match ? match[0].trim().replace(/^(lúc|luc|vào|vao|trước|truoc|hạn|han|deadline)\s+/iu, '') : null;
}

function extractGroupQuery(text, deadline) {
    const marker = /\b(?:nhóm|nhom|group|team)\b\s*/iu.exec(String(text));
    if (!marker) return null;
    let value = String(text).slice(marker.index + marker[0].length);
    if (deadline) {
        const deadlineIndex = value.toLocaleLowerCase().indexOf(deadline.toLocaleLowerCase());
        if (deadlineIndex >= 0) value = value.slice(0, deadlineIndex);
    }
    const delimiter = /\s+(?:cho|của|cua|với|voi)\s+|\s*[,;-]\s*/iu.exec(value);
    const stop = /\b(?:gọi|goi|hoàn thành|hoan thanh|kiểm tra|kiem tra|xử lý|xu ly|làm|lam|thực hiện|thuc hien|báo cáo|bao cao|gửi|gui|nhắc|nhac)\b/iu.exec(value);
    const end = delimiter?.index ?? stop?.index ?? value.length;
    return value.slice(0, end).trim() || null;
}

function extractAssigneeQuery(text, deadline, groupQuery) {
    let value = String(text).trim();
    value = value.replace(/^(giao|giao viec|giao việc|gui viec|gửi việc|phan cong|phân công)\b[\s:]*/iu, '');
    if (groupQuery) {
        const groupMarker = /\b(?:nhóm|nhom|group|team)\b\s*/iu.exec(value);
        if (groupMarker) {
            const beforeGroup = value.slice(0, groupMarker.index)
                .replace(/^\s*(?:cho|của|cua|với|voi)\s+/iu, '')
                .replace(/\s+(?:trong|thuộc|thuoc|tại|tai|ở|o)\s*$/iu, '')
                .replace(/^\s*(?:trong|thuộc|thuoc|tại|tai|ở|o)\s*$/iu, '')
                .trim();
            if (beforeGroup) {
                value = beforeGroup;
            } else {
                value = value.slice(groupMarker.index + groupMarker[0].length);
                const afterGroup = /\s+(?:cho|của|cua|với|voi)\s+|\s*[,;-]\s*/iu.exec(value);
                if (afterGroup) value = value.slice(afterGroup.index + afterGroup[0].length);
            }
        }
    } else {
        value = value.replace(/^cho\s+/iu, '');
    }
    value = value.replace(/^(?:em|anh|chi|chị|bạn|ban)\s+/iu, '');
    if (deadline) {
        const deadlineIndex = value.toLocaleLowerCase().indexOf(deadline.toLocaleLowerCase());
        if (deadlineIndex >= 0) value = value.slice(0, deadlineIndex);
    }
    const stop = /(?:^|\s)(?:gọi|goi|hoàn thành|hoan thanh|kiểm tra|kiem tra|xử lý|xu ly|làm|lam|thực hiện|thuc hien|báo cáo|bao cao|gửi|gui|nhắc|nhac)(?=\s|$)/iu.exec(value);
    return (stop ? value.slice(0, stop.index) : value).trim().replace(/[,:-]+$/, '').trim() || null;
}

function cleanTitle(text, { codes, deadline, assigneeQuery, groupQuery }) {
    let value = String(text).trim();
    value = value.replace(/^(giao|giao viec|giao việc|gui viec|gửi việc|phan cong|phân công)\b[\s:]*/iu, '');
    value = value.replace(/(^|\s)(?:cho|toi|tôi|em|anh|chi|chị)(?=\s|$)/giu, '$1');
    for (const code of codes) value = value.replace(new RegExp(`(?:[A-Za-z]*${code.slice(0, 2)}${code.slice(2)}|${code})`, 'iu'), ' ');
    if (groupQuery) {
        const groupMarker = /(?:(?:trong|ở|o)\s+)?(?:nhóm|nhom|group|team)\s*/iu.exec(value);
        if (groupMarker) {
            const end = groupMarker.index + groupMarker[0].length + groupQuery.length;
            value = `${value.slice(0, groupMarker.index)} ${value.slice(end)}`;
        }
    }
    if (assigneeQuery) {
        const assigneeIndex = value.toLocaleLowerCase().indexOf(assigneeQuery.toLocaleLowerCase());
        if (assigneeIndex >= 0) value = `${value.slice(0, assigneeIndex)} ${value.slice(assigneeIndex + assigneeQuery.length)}`;
    }
    if (deadline) {
        const deadlineIndex = value.toLocaleLowerCase().indexOf(deadline.toLocaleLowerCase());
        if (deadlineIndex >= 0) value = `${value.slice(0, deadlineIndex)} ${value.slice(deadlineIndex + deadline.length)}`;
    }
    value = value.replace(/^\s*(?:cho|trong|thuộc|thuoc)\s+/iu, ' ');
    value = value.replace(/\b(?:lúc|luc|vào|vao|trước|truoc|hạn|han|deadline)\b/giu, ' ');
    return value.replace(/[|,]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseGiao(text) {
    const codes = extractCodes(text);
    const dueInput = extractDeadline(text);
    const groupQuery = extractGroupQuery(text, dueInput);
    const assigneeQuery = extractAssigneeQuery(text, dueInput, groupQuery);
    const title = cleanTitle(text, { codes, deadline: dueInput, assigneeQuery, groupQuery });
    const normalized = normalizeVi(text);
    return {
        command: 'giao',
        codes,
        title,
        dueInput,
        ...(codes.length ? {} : {
            assigneeQuery,
            ...(groupQuery ? { groupQuery } : {}),
            sourceText: String(text)
        }),
        priority: /\b(gap|khan|uu tien cao|quan trong)\b/.test(normalized) ? 'HIGH' : 'NORMAL',
        reminderMode: /\b(hang ngay|moi ngay|daily)\b/.test(normalized) ? 'DAILY_AFTER_CHECKIN' : 'ONCE_BEFORE_DUE'
    };
}

function parseMessage(text, bulk) {
    const codes = extractCodes(text);
    let content = String(text).replace(/^(nhan|nhắn|gui|gửi)\s+(?:tin\s+nhan|message|tin)?\s*(?:cho|toi|tới|đến)?\s*/iu, '');
    if (bulk) content = content.replace(/^(keu|kêu|thong bao|thông báo)\s+(?:cho\s+)?(?:moi nguoi|mọi người|team|nhom|nhóm)\s*/iu, '');
    for (const code of codes) content = content.replace(new RegExp(`(?:[A-Za-z]*${code})`, 'iu'), ' ');
    const nameMatch = !codes.length ? /\b(?:anh|chi|chị|ban|bạn)\s+([\p{L}][\p{L}'-]{1,30})/iu.exec(content) : null;
    if (nameMatch) content = content.replace(nameMatch[0], ' ');
    content = content.trimStart().replace(/^(?:noi|nói)\s*/iu, '').replace(/^(?:ve|về)\s*/iu, '')
        .replace(/\b(?:noi|nói|ve|về)\b/giu, ' ').replace(/[\s,]+/g, ' ').trim();
    return { command: bulk ? 'guitinall' : 'guitin', codes, all: bulk && !codes.length && !nameMatch, recipientName: nameMatch?.[1] || null, content };
}

function extractReportGroup(text) {
    const marker = /\b(?:nhóm|nhom|group|team)\s+/iu.exec(String(text));
    if (!marker) return null;
    const value = String(text).slice(marker.index + marker[0].length);
    const stop = /(?:^|\s)(?:hôm nay|hom nay|hôm qua|hom qua|ngày mai|ngay mai|từ|tu|đến|den|trong khoảng|hôm|hom|ngày|ngay|ai|những ai|nhung ai|danh sách|danh sach|đi làm muộn|di lam muon|đi muộn|di muon|cho tôi|cho toi|lúc|luc|vào|vao|mỗi ngày|moi ngay|hàng ngày|hang ngay)(?=\s|$|[,.;!?])/iu.exec(value);
    const group = (stop ? value.slice(0, stop.index) : value).replace(/[,:;.!?]+$/, '').trim();
    return ['nào', 'nao'].includes(normalizeVi(group)) ? null : (group || null);
}

function extractReportDateInputs(text) {
    const value = String(text);
    const dateToken = '(?:hôm nay|hom nay|hôm qua|hom qua|ngày mai|ngay mai|nay|mai|\\d{1,2}\\s+tháng\\s+\\d{1,2}(?:\\s+năm\\s+\\d{4})?|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{4})?|\\d{4}-\\d{1,2}-\\d{1,2})';
    const range = new RegExp(`\\b(?:từ|tu|from)\\s+(?:ngày\\s+)?(${dateToken})(?:\\s+đến|\\s+den|\\s+to)\\s+(?:ngày\\s+)?(${dateToken})`, 'iu').exec(value);
    if (range) return { fromInput: range[1], toInput: range[2] };
    const dates = [...value.matchAll(new RegExp(dateToken, 'giu'))].map(match => match[0]);
    if (dates.length >= 2) return { fromInput: dates[0], toInput: dates[1] };
    if (dates.length === 1) return { fromInput: dates[0], toInput: dates[0] };
    return { fromInput: null, toInput: null };
}

function extractReportTime(text) {
    const match = /(?:\b(?:lúc|luc|vào|vao|khoảng|khoang)\s*)?(\d{1,2})(?::(\d{2})|h\s*(\d{1,2})?|\s*giờ(?:\s*(\d{1,2})\s*phút)?)\s*(sáng|sang|trưa|trua|chiều|chieu|tối|toi)?/iu.exec(String(text));
    if (!match) return null;
    return match[0].trim();
}

function parseAttendanceReport(text) {
    const normalized = normalizeVi(text);
    const schedule = /\b(hang ngay|moi ngay|daily)\b/.test(normalized)
        && /\b(bao cao|thong ke|diem danh|cham cong)\b/.test(normalized);
    const lateList = /\b(ai|nhung ai|danh sach|nhan vien|nhom nao).{0,35}\b(di lam muon|di muon|bi muon|cham gio)\b/.test(normalized)
        || /\b(di lam muon|di muon|bi muon|cham gio).{0,35}\b(ai|nhung ai|danh sach|nhan vien)\b/.test(normalized);
    const summary = /\b(bao cao|thong ke|tong hop|diem danh|cham cong)\b/.test(normalized)
        && /\b(nhom|group|team|ngay|hom nay|hom qua|tu|khoang|ky)\b/.test(normalized);
    if (!schedule && !lateList && !summary) return null;
    const dates = extractReportDateInputs(text);
    return {
        command: schedule ? 'datbaocao' : 'baocaodiem',
        metric: lateList ? 'late' : 'summary',
        groupQuery: extractReportGroup(text),
        fromInput: dates.fromInput,
        toInput: dates.toInput,
        ...(schedule ? { frequency: 'DAILY', timeInput: extractReportTime(text) } : {})
    };
}

export function parseNlpMessage(text) {
    const original = String(text ?? '').trim();
    if (!original || original.startsWith('/')) return null;
    const normalized = normalizeVi(original);

    const attendanceReport = parseAttendanceReport(original);
    if (attendanceReport) return attendanceReport;

    if (/\b(xuat|export|lay).{0,20}\b(excel|file)\b|\bexcel\b/.test(normalized)) {
        return { command: 'xuatexcel', kind: 'TASKS' };
    }
    if (/\b(canh bao|nhac).{0,35}\b(truoc|deadline|han)\b/.test(normalized) && /\b\d+\s*phut/.test(normalized)) {
        const minutes = normalized.match(/\b(\d+)\s*phut/)[1];
        return { command: 'cauhinh', key: 'due', value: minutes };
    }
    if (/\b(canh bao|nhac).{0,35}\b(cham|chua nhan|tre)\b/.test(normalized) && /\b\d+\s*phut/.test(normalized)) {
        const minutes = normalized.match(/\b(\d+)\s*phut/)[1];
        return { command: 'cauhinh', key: 'nhan', value: minutes };
    }
    if (/\b(giao viec|giao|gui viec|phan cong)\b/.test(normalized)) return parseGiao(original);
    if (/\b(nhac|keu).{0,35}\b(nhan vien|ho|lam viec|nhanh)\b/.test(normalized)) {
        return { command: /\b(han|deadline|sap den)\b/.test(normalized) ? 'nhacchuy_han' : 'nhacchua_nhan' };
    }
    if (/\b(sap den han|sap het han|deadline gan|gan het han)\b/.test(normalized)) return { command: 'viecsaptoihan' };
    if (/\b(qu[aá] han|qua han|chua xong|con chuyen gi)\b/.test(normalized)) return { command: 'viectruhan' };
    if (/\b(guitinall|nhom|team|moi nguoi|thong bao|keu moi nguoi)\b/i.test(normalized)) {
        return parseMessage(original, true);
    }
    if (/\b(nhan|nhắn|gui|gửi|gui message|gửi tin|nhan cho|nhắn cho|goi).{0,80}\b(NV|KT|NS)\d+/iu.test(original) || /\b(gui|gửi) message cho\b/.test(normalized)) {
        return parseMessage(original, false);
    }
    if (/\b(danh sach form|cac form|ds form)\b/.test(normalized)) return { command: 'dsform' };
    if (/\b(tong hop|bao cao tong hop)\b/.test(normalized)) return { command: 'tonghop', displayCode: extractTaskId(original)?.replace(/^/, '') || (original.match(/#?F-?(\d+)/i)?.[1] || null) };
    return null;
}
