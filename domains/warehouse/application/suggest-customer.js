/**
 * Gợi ý khách hàng cũ theo số điện thoại, để nhân viên không phải gõ lại tên.
 *
 * Chỉ đọc, không mở transaction. Dưới 4 chữ số thì không tra để tránh quét toàn
 * bộ đơn khi người dùng mới gõ được một hai số.
 */

export function createSuggestCustomerUseCase({ pool, catalogRepo }) {
    async function suggestCustomer(phone) {
        const normalized = String(phone || '').trim();
        if (normalized.length < 4) return null;
        return catalogRepo.findLatestCustomerByPhone(pool, normalized);
    }

    return { suggestCustomer };
}
