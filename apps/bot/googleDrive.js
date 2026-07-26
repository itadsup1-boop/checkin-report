import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import stream from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'hybrid-flame-499905-r2-3034c23f309c.json';
const credsPath = path.isAbsolute(keyFile) ? keyFile : path.join(__dirname, '../../', keyFile);

const FOLDER_ID = '1E4Wpquc1bJaDZnm2o9bj8NB-2bCb5xbx';

function getDriveClient() {
    const auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return google.drive({ version: 'v3', auth });
}

export async function uploadToDrive(buffer, filename, mimeType) {
    try {
        const drive = getDriveClient();
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const response = await drive.files.create({
            requestBody: {
                name: filename,
                parents: [FOLDER_ID],
            },
            media: {
                mimeType: mimeType,
                body: bufferStream,
            },
            fields: 'id, webViewLink, webContentLink',
        });

        // Tự động cấp quyền public (ai có link cũng xem được) để Mini App / Spreadsheet có thể hiển thị ảnh
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        return response.data;
    } catch (error) {
        console.error('Lỗi upload Google Drive:', error);
        throw error;
    }
}

export async function deleteOldPhotos() {
    try {
        const drive = getDriveClient();
        // 35 ngày trước
        const dateLimit = new Date();
        dateLimit.setDate(dateLimit.getDate() - 35);
        const rfc3339Date = dateLimit.toISOString();

        let pageToken = null;
        let deletedCount = 0;

        do {
            const res = await drive.files.list({
                q: `'${FOLDER_ID}' in parents and createdTime < '${rfc3339Date}'`,
                fields: 'nextPageToken, files(id, name, createdTime)',
                pageToken: pageToken,
            });

            for (const file of res.data.files) {
                console.log(`[Drive] Đang xóa file rác cũ > 35 ngày: ${file.name} (${file.createdTime})`);
                await drive.files.delete({ fileId: file.id });
                deletedCount++;
                // Nghỉ 1s tránh rate limit
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            pageToken = res.data.nextPageToken;
        } while (pageToken);

        if (deletedCount > 0) {
            console.log(`[Drive] Đã dọn dẹp xong ${deletedCount} ảnh cũ.`);
        }
    } catch (error) {
        console.error('Lỗi khi xóa ảnh cũ trên Drive:', error);
    }
}
