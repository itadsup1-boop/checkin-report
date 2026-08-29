import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createAdminAuth } from '../../api/admin-auth.js';
import { webAdminSecurityHeaders } from '../../../packages/shared/web-admin-security-headers.js';
import { loggerMiddleware } from '../../../packages/shared/logger.js';
import { getGroupRole } from '../role_guard.js';

export function configureBotHttp({ botApp, pool, cors, baseDir, authenticateTelegramMiniApp }) {
    const corsOptions = {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-telegram-init-data'],
        credentials: true,
        optionsSuccessStatus: 204
    };
    
    botApp.use(cors(corsOptions));
    botApp.use(loggerMiddleware);
    
    botApp.use(express.json({ limit: '200mb' }));
    botApp.use(express.urlencoded({ limit: '200mb', extended: true }));
    botApp.use(webAdminSecurityHeaders);
    
    // Serve Web Admin React App & Mini App
    const webAdminDistPath = path.join(baseDir, '../web-admin/dist');
    botApp.use(express.static(webAdminDistPath));
    
    // ---------------------------------------------------------------------------
    // Chống cache cho Mini App xuất kho (nạp code dạng ES module).
    //
    // Origin đã trả Cache-Control: max-age=0 nhưng Cloudflare ghi đè thành
    // max-age=14400 (4 giờ), nên client giữ file .js cũ và không hỏi lại server.
    // Sửa bằng header là vô ích — phải đổi URL. Asset được nạp qua tiền tố
    // /mini-app/_v<token>/... với token tính theo mtime mới nhất của thư mục module,
    // nên mỗi lần sửa code là URL đổi và client tải lại ngay.
    // Chỉ ảnh hưởng đường dẫn có tiền tố /_v; các Mini App khác giữ nguyên.
    // ---------------------------------------------------------------------------
    // Các thư mục module Mini App. shared-ui là hạ tầng dùng chung nên phải nằm trong
    // danh sách: sửa core/ hay icons.js cũng cần đổi token.
    // Thêm nghiệp vụ mới (timekeep/, scheduling/…) thì khai báo thêm ở đây.
    const warehouseAssetDirs = ['warehouse', 'scheduling', 'customer', 'shared-ui']
        .map(name => path.join(baseDir, 'public', name));
    
    // Shell nào chứa __ASSET_V__ thì khai báo ở đây.
    const warehouseShells = {
        '/mini-app/warehouse_export.html': path.join(baseDir, 'public', 'warehouse_export.html'),
        '/mini-app/warehouse_import.html': path.join(baseDir, 'public', 'warehouse_import.html'),
        '/mini-app/warehouse_inventory.html': path.join(baseDir, 'public', 'warehouse_inventory.html'),
        '/mini-app/warehouse_pricing.html': path.join(baseDir, 'public', 'warehouse_pricing.html'),
        '/mini-app/schedule_client.html': path.join(baseDir, 'public', 'schedule_client.html'),
        '/mini-app/customer_form.html': path.join(baseDir, 'public', 'customer_form.html')
    };
    
    let warehouseAssetVersionCache = { token: '0', checkedAt: 0 };
    
    function getWarehouseAssetVersion() {
        const now = Date.now();
        if (now - warehouseAssetVersionCache.checkedAt < 5000) {
            return warehouseAssetVersionCache.token;
        }
    
        let newestMtime = 0;
        const walk = directory => {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                const fullPath = path.join(directory, entry.name);
                if (entry.isDirectory()) walk(fullPath);
                else newestMtime = Math.max(newestMtime, fs.statSync(fullPath).mtimeMs);
            }
        };
    
        for (const directory of warehouseAssetDirs) {
            try {
                walk(directory);
            } catch (error) {
                newestMtime = now;
            }
        }
    
        warehouseAssetVersionCache = { token: Math.floor(newestMtime).toString(36), checkedAt: now };
        return warehouseAssetVersionCache.token;
    }
    
    // Bỏ tiền tố phiên bản khỏi URL đầy đủ (middleware không mount để req.url giữ nguyên
    // thay đổi cho các layer sau).
    botApp.use((req, res, next) => {
        const match = req.url.match(/^\/mini-app\/_v[^/]+(\/.*)$/);
        if (match) req.url = `/mini-app${match[1]}`;
        next();
    });
    
    // Shell Mini App kho: chèn token phiên bản và không cho cache, để client luôn nhận
    // đúng URL asset mới nhất. Đặt trước express.static để thắng file tĩnh.
    for (const [routePath, shellFile] of Object.entries(warehouseShells)) {
        botApp.get(routePath, (req, res, next) => {
            try {
                const html = fs.readFileSync(shellFile, 'utf8')
                    .replace(/__ASSET_V__/g, getWarehouseAssetVersion());
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store, must-revalidate');
                res.send(html);
            } catch (error) {
                next();
            }
        });
    }
    
    botApp.use('/mini-app', express.static(path.join(baseDir, 'public')));
    botApp.get('/', (req, res) => {
        res.sendFile(path.join(webAdminDistPath, 'index.html'));
    });
    
    // Áp dụng middleware bảo mật cho toàn bộ API /api/timekeep
    botApp.use('/api/timekeep', authenticateTelegramMiniApp);
    
    botApp.use('/api/timekeep', async (req, res, next) => {
        const groupId = req.body.telegram_group_id || req.body.chat_id || req.query.chat_id || req.query.telegram_group_id;
        if (groupId) {
            const role = await getGroupRole(groupId);
            const isRegistration = req.path === '/register';
            const allowedRoles = isRegistration ? ['timekeep', 'report', 'report_tour', 'customer', 'warehouse'] : ['timekeep'];
            if (!allowedRoles.includes(role)) {
                return res.status(403).json({
                    success: false,
                    message: isRegistration
                        ? 'Nhóm này không được cấu hình chức năng đăng ký tài khoản.'
                        : 'Nhóm này không được cấu hình chức năng chấm công.'
                });
            }
        }
        next();
    });
    
    // Các route Web Admin trên tiến trình bot cũng phải dùng cùng session bảo mật
    // với API chính; danh tính và vai trò luôn lấy từ session trong database.
    const botAdminAuth = createAdminAuth({ pool });
    botApp.use('/api/admin', botAdminAuth.authenticateAdmin);
    botApp.use('/api/tk_group_settings', botAdminAuth.authenticateAdmin);
    botApp.use('/api/export', botAdminAuth.authenticateAdmin);

    return { corsOptions };
}
