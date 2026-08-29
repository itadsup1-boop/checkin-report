import path from 'node:path';

export function registerProxyRoutes({ app, express, isDocker, botUrl, webAdminPath, botAppPath }) {
    app.get('/isdocker', (req, res) => {
        res.json({ isDocker });
    });
    
    // Serve Web Admin frontend
    app.use(express.static(webAdminPath));
    
    // Proxy routes to KPI Bot on port 3002 for Mini-App
    app.get('/api/bot/get-report-today', async (req, res) => {
        try {
            const fetch = (await import('node-fetch')).default || globalThis.fetch;
            // Chuyển tiếp toàn bộ query string
            const urlObj = new URL(`${botUrl}/api/bot/get-report-today`);
            for (const [key, value] of Object.entries(req.query)) {
                urlObj.searchParams.append(key, value);
            }
    
            const headers = {};
            const initData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
            if (initData) headers['x-telegram-init-data'] = initData;
            if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'];
    
            const response = await fetch(urlObj.toString(), { headers });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    app.post('/api/bot/submit-report', async (req, res) => {
        try {
            const fetch = (await import('node-fetch')).default || globalThis.fetch;
            const headers = { 'Content-Type': 'application/json' };
            const initData = req.headers['x-telegram-init-data'] || req.headers['X-Telegram-Init-Data'];
            if (initData) headers['x-telegram-init-data'] = initData;
            if (req.headers['authorization']) headers['authorization'] = req.headers['authorization'];
    
            const response = await fetch(`${botUrl}/api/bot/submit-report`, {
                method: 'POST',
                headers,
                body: JSON.stringify(req.body)
            });
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    // Proxy schedule mutation routes to bot (POST, PUT, DELETE to /api/admin/schedules)
    app.use('/api/admin/schedules', async (req, res, next) => {
        if (req.method === 'GET') {
            return next();
        }
        try {
            const fetch = (await import('node-fetch')).default || globalThis.fetch;
            const urlObj = new URL(botUrl + req.originalUrl);
    
            const options = {
                method: req.method,
                headers: { ...req.headers }
            };
    
            delete options.headers.host;
    
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
                options.body = JSON.stringify(req.body);
                options.headers['Content-Type'] = 'application/json';
            }
    
            const response = await fetch(urlObj.toString(), options);
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    // Proxy schedule, photo, dashboard and export routes to bot
    app.use(['/api/schedules', '/api/photo-debts', '/api/upload-proof', '/api/timekeep', '/api/tk_group_settings', '/api/admin/dashboard', '/api/export'], async (req, res) => {
        try {
            const fetch = (await import('node-fetch')).default || globalThis.fetch;
            const urlObj = new URL(botUrl + req.originalUrl);
    
            const options = {
                method: req.method,
                headers: { ...req.headers }
            };
    
            // Remove host to avoid conflicts
            delete options.headers.host;
    
            if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
                options.body = JSON.stringify(req.body);
                options.headers['Content-Type'] = 'application/json';
            }
    
            const response = await fetch(urlObj.toString(), options);
    
            // Nếu là 304 Not Modified, trả về ngay lập tức để tránh parse JSON lỗi
            if (response.status === 304) {
                return res.sendStatus(304);
            }
    
            const contentType = response.headers.get('content-type') || '';
            if (
                contentType.includes('text/csv') ||
                contentType.includes('application/octet-stream') ||
                contentType.includes('text/plain') ||
                contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
                contentType.includes('spreadsheet') ||
                contentType.includes('excel')
            ) {
                const buffer = Buffer.from(await response.arrayBuffer());
                if (contentType) res.setHeader('Content-Type', contentType);
                const contentDisposition = response.headers.get('content-disposition');
                if (contentDisposition) res.setHeader('Content-Disposition', contentDisposition);
                return res.status(response.status).send(buffer);
            }
    
            const data = await response.json();
            res.status(response.status).json(data);
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });
    
    // Serve Web Admin React App & Mini App
    app.use(express.static(webAdminPath));
    
    app.use('/mini-app', express.static(botAppPath));
    
    // Các route không match API sẽ trả về file index.html (cho React Router)
    app.use((req, res) => {
        res.sendFile(path.join(webAdminPath, 'index.html'));
    });
}
