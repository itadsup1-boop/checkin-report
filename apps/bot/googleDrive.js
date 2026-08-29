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
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
        const oauth2Client = new google.auth.OAuth2(
            clientId,
            clientSecret,
            'https://developers.google.com/oauthplayground' // Default redirect URI or playground
        );
        oauth2Client.setCredentials({ refresh_token: refreshToken });
        return google.drive({ version: 'v3', auth: oauth2Client });
    }

    const auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return google.drive({ version: 'v3', auth });
}

export async function uploadToDrive(buffer, filename, mimeType, parentFolderId) {
    try {
        const drive = getDriveClient();
        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);

        const response = await drive.files.create({
            requestBody: {
                name: filename,
                parents: [parentFolderId || FOLDER_ID],
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

export async function getOrCreateCustomerFolder(parentFolderId, phone) {
    try {
        const drive = getDriveClient();
        const pId = parentFolderId || FOLDER_ID;
        
        // Tìm kiếm thư mục có tên là số điện thoại của khách hàng nằm trong thư mục cha
        const searchResponse = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${phone}' and '${pId}' in parents and trashed=false`,
            fields: 'files(id, webViewLink)',
        });

        if (searchResponse.data.files && searchResponse.data.files.length > 0) {
            console.log(`[Drive] Thư mục cho khách hàng ${phone} đã tồn tại: ${searchResponse.data.files[0].id}`);
            return searchResponse.data.files[0];
        }

        // Nếu chưa tồn tại, tạo thư mục mới
        console.log(`[Drive] Tạo thư mục mới cho khách hàng: ${phone}`);
        const response = await drive.files.create({
            requestBody: {
                name: phone,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [pId],
            },
            fields: 'id, webViewLink',
        });

        // Cấp quyền public (ai có link cũng xem được)
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        return response.data;
    } catch (error) {
        console.error('Lỗi tạo/tìm thư mục Google Drive cho khách hàng:', error);
        throw error;
    }
}
export async function createWarehouseFolder(parentFolderId, folderName) {
    try {
        const drive = getDriveClient();
        const pId = parentFolderId || '1VDcvrEc5nvVrvYsz1ShImZ21GsK7dQ8P';
        
        console.log(`[Drive] Tạo thư mục nhập kho mới: ${folderName}`);
        const response = await drive.files.create({
            requestBody: {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [pId],
            },
            fields: 'id, webViewLink',
        });

        // Cấp quyền public (ai có link cũng xem được)
        await drive.permissions.create({
            fileId: response.data.id,
            requestBody: {
                role: 'reader',
                type: 'anyone',
            },
        });

        return response.data;
    } catch (error) {
        console.error('Lỗi tạo thư mục Google Drive nhập kho:', error);
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
