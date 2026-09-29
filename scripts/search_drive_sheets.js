import 'dotenv/config';
import { google } from 'googleapis';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || 'hybrid-flame-499905-r2-3034c23f309c.json';
const credsPath = path.isAbsolute(keyFile) ? keyFile : path.join(__dirname, '../', keyFile);

async function searchDrive() {
    const auth = new google.auth.GoogleAuth({
        keyFile: credsPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    const drive = google.drive({ version: 'v3', auth });
    
    const res = await drive.files.list({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: 'files(id, name, modifiedTime)',
        pageSize: 50
    });
    
    console.log('Found Spreadsheets:');
    console.table(res.data.files);
}

searchDrive().catch(console.error);
