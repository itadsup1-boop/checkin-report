import imghash from 'imghash';
import { Jimp, JimpMime } from 'jimp';

// Hàm tính toán sự khác biệt giữa 2 mã vân tay (Thuật toán Hamming Distance)
// Khoảng cách càng nhỏ (gần 0) thì ảnh càng giống nhau.
function hammingDistance(hash1, hash2) {
    let distance = 0;
    try {
        const bin1 = BigInt('0x' + hash1).toString(2).padStart(64, '0');
        const bin2 = BigInt('0x' + hash2).toString(2).padStart(64, '0');
        for (let i = 0; i < 64; i++) {
            if (bin1[i] !== bin2[i]) distance++;
        }
    } catch(e) {
        return 64; // Trả về khác hoàn toàn nếu có lỗi
    }
    return distance;
}

// Hàm lấy dữ liệu ảnh Base64 và dịch ra mã vân tay pHash
export async function computeHashFromBase64(base64Data) {
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        const image = await Jimp.read(buffer);
        // Resize cực nhỏ và chuyển sang trắng đen để loại bỏ nhiễu màu/cắt cúp
        image.resize({ w: 128, h: 128 }).greyscale();
        const processedBuffer = await image.getBuffer(JimpMime.jpeg);
        const pHash = await imghash.hash(processedBuffer, 8); // Chặt ra block 8x8 tạo 64-bit mã
        return pHash;
    } catch (e) {
        console.error("Lỗi tạo pHash:", e);
        return null;
    }
}

// Hàm dò tìm ảnh cũ trong Database (Quét lịch sử 30 ngày)
export async function findDuplicateImages(pool, newHashesArray) {
    if (process.env.DISABLE_IMAGE_DUPLICATE_CHECK === 'true') {
        return [];
    }
    // newHashesArray là danh sách các ảnh vừa nộp: [{ index: 1, hash: 'abc...', file_id: '...' }]
    
    // Kéo lịch sử ảnh 30 ngày qua ra đối chiếu
    const recentRes = await pool.query(`
        SELECT f.phash, f.telegram_file_id, f.created_at, e.full_name as employee_name
        FROM image_fingerprints f
        LEFT JOIN employees e ON f.employee_id = e.id
        WHERE f.created_at >= NOW() - INTERVAL '30 days'
    `);
    
    const dbHashes = recentRes.rows;
    const duplicates = [];

    for (const item of newHashesArray) {
        if (!item.hash) continue;
        for (const dbItem of dbHashes) {
            const distance = hammingDistance(item.hash, dbItem.phash);
            
            // Nếu khoảng cách <= 5 bit (Tức là giống nhau trên 92%)
            if (distance <= 5) {
                duplicates.push({
                    new_index: item.index,
                    new_file_id: item.file_id,
                    old_employee: dbItem.employee_name,
                    old_file_id: dbItem.telegram_file_id,
                    old_date: dbItem.created_at,
                    similarity: 100 - Math.round((distance / 64) * 100) // Tính ra % giống nhau
                });
                break; // Tìm thấy 1 bản sao là đủ, dừng quét ảnh này
            }
        }
    }
    
    return duplicates;
}

// Hàm lưu vân tay các ảnh mới (Không trùng) vào Database làm dữ liệu gốc cho lần sau
export async function saveHashesToDB(pool, employeeId, hashesArray) {
    for (const item of hashesArray) {
        if (!item.hash || !item.file_id) continue;
        await pool.query(
            `INSERT INTO image_fingerprints (employee_id, telegram_file_id, phash, report_date)
             VALUES ($1, $2, $3, CURRENT_DATE)`,
            [employeeId, item.file_id, item.hash]
        );
    }
}
