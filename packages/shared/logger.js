import fs from 'fs';
import path from 'path';
import cron from 'node-cron';

const originalLog = console.log;
const originalError = console.error;

let logFilePath = '';

/**
 * Initializes the log file path and directory
 * @param {string} filePath - Path to the log file
 */
export function initLogger(filePath) {
    logFilePath = path.resolve(filePath);
    const logDir = path.dirname(logFilePath);
    try {
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        if (!fs.existsSync(logFilePath)) {
            fs.writeFileSync(logFilePath, '', 'utf8');
        }
    } catch (e) {
        originalError(`[LOGGER ERROR] Failed to initialize log file at ${logFilePath}:`, e.message);
    }
}

/**
 * Writes a log line to the file and stdout/stderr
 */
export function writeLog(level, message) {
    if (!logFilePath) {
        logFilePath = path.resolve('./logs/combined.log');
    }
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
    try {
        const logDir = path.dirname(logFilePath);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        fs.appendFileSync(logFilePath, logLine, 'utf8');
    } catch (e) {
        originalError('[LOGGER ERROR] Failed to write log:', e.message);
    }

    if (level.toLowerCase() === 'error') {
        originalError(logLine.trim());
    } else {
        originalLog(logLine.trim());
    }
}

/**
 * Express middleware to log requests
 */
export function loggerMiddleware(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        writeLog('info', `${clientIp} - "${req.method} ${req.originalUrl} HTTP/${req.httpVersion}" ${res.statusCode} ${duration}ms "${req.headers['user-agent'] || '-'}"`);
    });
    next();
}

/**
 * Schedules log rotation
 */
export function setupLogRotation() {
    if (!logFilePath) return;

    cron.schedule('0 0 * * *', () => {
        writeLog('info', 'Starting log rotation job...');
        if (!fs.existsSync(logFilePath)) {
            writeLog('info', 'No active log file found to rotate.');
            return;
        }

        try {
            const dateStr = new Date().toISOString().split('T')[0];
            const dir = path.dirname(logFilePath);
            const ext = path.extname(logFilePath);
            const base = path.basename(logFilePath, ext);
            const rotatedPath = path.join(dir, `${base}_${dateStr}${ext}`);

            // Copy-and-truncate rotation
            fs.copyFileSync(logFilePath, rotatedPath);
            fs.truncateSync(logFilePath, 0);

            writeLog('info', `Log file rotated to: ${rotatedPath}`);

            // Delete rotated logs older than 14 days
            const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
            const now = Date.now();
            const files = fs.readdirSync(dir);

            for (const file of files) {
                if (file.startsWith(base) && file !== path.basename(logFilePath)) {
                    const filePath = path.join(dir, file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        fs.unlinkSync(filePath);
                        writeLog('info', `Deleted old log file: ${file}`);
                    }
                }
            }
        } catch (err) {
            writeLog('error', `Log rotation failed: ${err.message}`);
        }
    });

    writeLog('info', 'Log rotation job scheduled.');
}

/**
 * Overrides global console.log and console.error to write to the log file automatically
 */
export function overrideGlobals() {
    console.log = (...args) => {
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
        writeLog('info', msg);
    };
    console.error = (...args) => {
        const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
        writeLog('error', msg);
    };
}
