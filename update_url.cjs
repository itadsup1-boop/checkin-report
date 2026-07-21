const fs = require('fs');
const { execSync } = require('child_process');

try {
    const logData = fs.readFileSync('cf_err.log', 'utf8');
    const match = logData.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    
    if (match) {
        const url = match[0];
        console.log('\n=========================================================');
        console.log('🌐 LINK MINI APP MOI CUA BAN LA:');
        console.log(url);
        console.log('=========================================================\n');
        
        let envData = fs.readFileSync('.env', 'utf8');
        if (envData.includes('MINI_APP_URL=')) {
            envData = envData.replace(/MINI_APP_URL=.*/g, `MINI_APP_URL=${url}`);
        } else {
            envData += `\nMINI_APP_URL=${url}`;
        }
        fs.writeFileSync('.env', envData);
        
        console.log('✅ Da tu dong cap nhat link moi vao file .env');
        console.log('🔄 Dang khoi dong lai Bot de nhan link moi...');
        execSync('pm2 restart kpi-bot', { stdio: 'inherit' });
        console.log('✅ Hoan tat!');
    } else {
        console.log('\n❌ Khong tim thay link Cloudflare trong cf_err.log. Vui long kiem tra lai mang hoac chay lai start.bat.');
    }
} catch (e) {
    console.log('Loi doc file cf_err.log:', e.message);
}
