const path = require('path');
const fs = require('fs');

// Root của dự án (thư mục chứa file này)
const PROJECT_ROOT = path.resolve(__dirname);

// Đọc .env thủ công để PM2 luôn nhận đúng giá trị mới nhất
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, '.env');
  if (!fs.existsSync(envPath)) return {};
  const env = {};
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      env[key] = val;
    });
  return env;
}

const envVars = loadEnv();

module.exports = {
  apps: [
    {
      name: 'kpi-api',
      script: 'apps/api/index.js',
      cwd: PROJECT_ROOT,
      env: {
        ...envVars,
        NODE_OPTIONS: '--dns-result-order=ipv4first --no-network-family-autoselection',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: 'timekeep-bot',
      script: 'apps/bot/timekeep_bot.js',
      cwd: PROJECT_ROOT,
      env: {
        ...envVars,
        NODE_OPTIONS: '--dns-result-order=ipv4first --no-network-family-autoselection',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: 'cloudflare-tunnel',
      script: 'cloudflared.exe',
      args: 'tunnel --url http://localhost:3001',
      cwd: PROJECT_ROOT,
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      out_file: 'cloudflare.log',
      error_file: 'cf_err.log'
    }
  ],
};
