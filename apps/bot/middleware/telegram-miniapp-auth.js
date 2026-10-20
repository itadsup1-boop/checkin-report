import crypto from 'node:crypto';

export function createTelegramMiniAppAuth({ bot, pool }) {
    // Verify Telegram WebApp initData HMAC signature
    function verifyTelegramWebAppData(initDataRaw, maxAgeSeconds = 86400) {
        if (!initDataRaw) return null;
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) return null;
    
        try {
            const urlParams = new URLSearchParams(initDataRaw);
            const hash = urlParams.get('hash');
            if (!hash) return null;
    
            // Check auth_date to prevent replay attacks
            const authDateStr = urlParams.get('auth_date');
            if (!authDateStr) {
                console.warn('[Security] initData missing auth_date!');
                return null;
            }
    
            const authDate = parseInt(authDateStr, 10);
            const now = Math.floor(Date.now() / 1000);
            if (isNaN(authDate) || (now - authDate) > maxAgeSeconds || (authDate - now) > 300) {
                console.warn('[Security] initData auth_date expired or invalid!', { authDate, now, age: now - authDate });
                return null;
            }
    
            urlParams.delete('hash');
    
            const keys = Array.from(urlParams.keys()).sort();
            const dataCheckArr = keys.map(key => `${key}=${urlParams.get(key)}`);
            const dataCheckString = dataCheckArr.join('\n');
    
            const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
            const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    
            if (calculatedHash !== hash) {
                console.warn('[Security] initData hash mismatch!');
                return null;
            }
    
            const userJson = urlParams.get('user');
            if (!userJson) return null;
    
            return JSON.parse(userJson);
        } catch (err) {
            console.error('[Security] Error validating initData:', err);
            return null;
        }
    }
    
    // Create signed payload for startapp links
    function createSignedPayload(action, groupId) {
        const token = process.env.TELEGRAM_BOT_TOKEN || '';
        const ts = Date.now();
        const dataString = `${action}:${groupId}:${ts}`;
        const sig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
        return `${action}_${groupId}_${ts}_${sig}`;
    }
    
    // Verify signed payload
    function verifySignedPayload(action, groupId, ts, sig) {
        if (!groupId || !ts || !sig) return false;
        const token = process.env.TELEGRAM_BOT_TOKEN || '';
        const now = Date.now();
        const age = now - parseInt(ts, 10);
        if (isNaN(age) || age < -300000) { // Removed 24h expiration (age > 86400000)
            return false;
        }
    
        if (!action) return false;
        const dataString = `${action}:${groupId}:${ts}`;
        const expectedSig = crypto.createHmac('sha256', token).update(dataString).digest('hex');
        if (sig.length === expectedSig.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return true;
    
        return false;
    }
    
    // Middleware xác thực bảo mật cho Mini App API
    async function authenticateTelegramMiniApp(req, res, next) {
        try {
            const initData = req.headers['x-telegram-init-data'] ||
                (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null) ||
                req.body?.initData || req.query?.initData;
    
            if (!initData) {
                return res.status(401).json({ success: false, message: 'Vui lòng thao tác trực tiếp trên ứng dụng Telegram (Thiếu initData).' });
            }
    
            const telegramUser = verifyTelegramWebAppData(initData);
            if (!telegramUser || !telegramUser.id) {
                return res.status(401).json({ success: false, message: 'Xác thực Telegram không hợp lệ hoặc đã hết hạn.' });
            }
    
            const verifiedId = telegramUser.id.toString();
            req.telegramUser = telegramUser;
            req.verifiedTelegramId = verifiedId;
    
            // Force set verified ID on req.body and req.query unconditionally to prevent spoofing
            if (!req.body) req.body = {};
            req.body.telegram_id = verifiedId;
            if (!req.query) req.query = {};
            req.query.telegram_id = verifiedId;
    
            const groupId = req.query.chat_id || req.body.chat_id || req.body.telegram_group_id;
            const ts = req.query.ts || req.body.ts;
            const sig = req.query.sig || req.body.sig;
            const action = req.query.action || req.body.action;
    
            if (groupId) {
                // Verify signed payload unconditionally for group-bound actions
                if (!ts || !sig) {
                    return res.status(403).json({ success: false, message: 'Thiếu chữ ký thao tác (Signed Payload).' });
                }
                const isValidPayload = verifySignedPayload(action, groupId.toString(), ts, sig);
                if (!isValidPayload) {
                    return res.status(403).json({ success: false, message: 'Chữ ký thao tác (Signed Payload) không hợp lệ hoặc đã hết hạn.' });
                }
    
                const groupCheck = await pool.query('SELECT * FROM telegram_groups WHERE telegram_group_id = $1', [groupId.toString()]);
                if (groupCheck.rows.length === 0) {
                    return res.status(403).json({ success: false, message: 'Nhóm Telegram này chưa được đăng ký vào hệ thống.' });
                }
    
                // Chạy kiểm tra thành viên với timeout 2.5s và cơ chế fail-open khi lỗi mạng
                try {
                    const runWithTimeout = (promise, ms) => {
                        const timeout = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('TIMEOUT')), ms)
                        );
                        return Promise.race([promise, timeout]);
                    };
    
                    const checkMembership = async () => {
                        const botMe = await bot.telegram.getMe();
                        const botMember = await bot.telegram.getChatMember(groupId.toString(), botMe.id);
                        if (!['member', 'administrator', 'creator'].includes(botMember.status)) {
                            throw new Error('BOT_LEFT_GROUP');
                        }
    
                        const userMember = await bot.telegram.getChatMember(groupId.toString(), parseInt(verifiedId, 10));
                        if (['left', 'kicked'].includes(userMember.status)) {
                            throw new Error('USER_NOT_MEMBER');
                        }
                    };
    
                    await runWithTimeout(checkMembership(), 2500);
                } catch (err) {
                    console.warn('[Security] Membership verification skipped/failed:', err.message);
                    
                    if (err.message === 'BOT_LEFT_GROUP') {
                        return res.status(403).json({ success: false, message: 'Bot đã không còn nằm trong nhóm này.' });
                    }
                    if (err.message === 'USER_NOT_MEMBER') {
                        return res.status(403).json({ success: false, message: 'Bạn không phải là thành viên nhóm này.' });
                    }
                    
                    // Nếu là lỗi TIMEOUT hoặc lỗi kết nối mạng Telegram, ta cho phép bỏ qua (vì đã xác thực chữ ký Signed Payload ở trên)
                    // Telegram giới hạn tần suất gọi getChatMember — khi nhiều Mini App gọi
                    // dồn dập (vd gõ tìm kiếm liên tục), Telegram trả 429 "Too Many Requests".
                    // Đây KHÔNG phải lỗi bảo mật, chỉ là Telegram đang bận — coi như lỗi mạng,
                    // bỏ qua kiểm tra thành viên vì chữ ký Signed Payload đã xác thực ở trên rồi.
                    const isRateLimited = err.response?.error_code === 429 ||
                                          err.message.includes('Too Many Requests');
    
                    const isNetworkError = isRateLimited ||
                                           err.message === 'TIMEOUT' ||
                                           err.code === 'ETIMEDOUT' ||
                                           err.code === 'ECONNRESET' ||
                                           err.code === 'ENOTFOUND' ||
                                           err.code === 'EAI_AGAIN' ||
                                           err.message.includes('connect ETIMEDOUT') ||
                                           err.message.includes('read ECONNRESET');
    
                    if (isNetworkError) {
                        console.warn(`[Security] Telegram API network issue (${err.message}). Bypassing membership check as signature is valid.`);
                    } else {
                        const errMsg = err.message || '';
                        const errDesc = err.response?.description || '';
                        if (errMsg.includes('PARTICIPANT_ID_INVALID') || errDesc.includes('PARTICIPANT_ID_INVALID')) {
                            console.warn(`[Security] getChatMember returned PARTICIPANT_ID_INVALID, bypassing.`);
                        } else {
                            return res.status(403).json({
                                success: false,
                                message: 'Xác thực thành viên nhóm thất bại: ' + (err.response?.description || err.message)
                            });
                        }
                    }
                }
            }
    
            next();
        } catch (error) {
            console.error('[Auth Middleware Error]', error);
            return res.status(500).json({ success: false, message: 'Lỗi xác thực hệ thống: ' + error.message });
        }
    }

    return { authenticateTelegramMiniApp, createSignedPayload, verifySignedPayload, verifyTelegramWebAppData };
}
