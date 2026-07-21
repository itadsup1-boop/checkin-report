/**
 * Giao tiếp với External Media Duplicate Validator Service
 */

export async function checkImageWithExternalService(buffer, filename = 'image.jpg') {
    if (process.env.DISABLE_IMAGE_DUPLICATE_CHECK === 'true') {
        return { status: 'DISABLED' };
    }

    try {
        const apiUrl = process.env.IMAGE_VALIDATOR_API_URL || 'http://localhost:3354';
        
        const blob = new Blob([buffer], { type: 'image/jpeg' });
        const formData = new FormData();
        formData.append('file', blob, filename);

        const response = await fetch(`${apiUrl}/check-image`, {
            method: 'POST',
            body: formData,
            // Không set Content-Type header thủ công, fetch sẽ tự động set kèm boundary
        });

        if (!response.ok) {
            console.error(`External API error: ${response.status} ${response.statusText}`);
            return { status: 'ERROR', message: `API responded with ${response.status}` };
        }

        const data = await response.json();
        return data;
    } catch (e) {
        console.error("Lỗi khi kết nối External Validator Service:", e);
        return { status: 'ERROR', message: e.message };
    }
}
