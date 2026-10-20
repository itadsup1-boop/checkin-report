/**
 * Phần 2 — Thanh toán: hóa đơn, đã trả, còn nợ, thợ thực hiện, bảo hành.
 *
 * Ô "Còn nợ" tự tính và KHÓA lại: để nhân viên tự gõ thì con số sẽ lệch với
 * hóa đơn trừ đã trả, và đây là số vào doanh thu nên không được lệch.
 */

import { h } from '../../../shared-ui/core/dom.js';
import { parseMoney, computeDebt, formatMoney } from '../domain/record-rules.js';
import { card, sectionTitle, field, textInput, row } from '../ui/components.js';

export function createMoneySection() {
    const bill = textInput({ placeholder: 'VD: 30tr hoặc 30000000', inputMode: 'text' });
    const paid = textInput({ placeholder: 'VD: 500k', inputMode: 'text' });
    const debt = textInput({ placeholder: '0', disabled: true });

    const recalc = () => { debt.value = formatMoney(computeDebt(bill.value, paid.value)); };
    bill.addEventListener('input', recalc);
    paid.addEventListener('input', recalc);
    recalc();

    const operator = textInput({ placeholder: 'Người thực hiện dịch vụ' });
    const warranty = textInput({ placeholder: 'Thời hạn bảo hành (nếu có)' });

    const node = card(
        sectionTitle('Thanh toán'),
        row(
            field({
                label: 'Hóa đơn', required: true, input: bill,
                hint: 'Gõ tắt được: 30tr · 500k · 1.500.000'
            }),
            field({ label: 'Đã trả', required: true, input: paid })
        ),
        field({ label: 'Còn nợ', input: debt, hint: 'Tự tính = Hóa đơn − Đã trả' }),
        field({ label: 'Thợ thực hiện', required: true, input: operator }),
        field({ label: 'Bảo hành', input: warranty })
    );

    return {
        node,
        read: () => ({
            // Gửi lên máy chủ dạng SỐ đã quy đổi, không gửi chuỗi "30tr".
            bill_amount: parseMoney(bill.value),
            paid_amount: parseMoney(paid.value),
            debt_amount: computeDebt(bill.value, paid.value),
            operator: operator.value.trim(),
            warranty: warranty.value.trim()
        })
    };
}
