module.exports = {
  apps: [
    {
      name: 'kpi-api',
      script: 'apps/api/index.js',
      cwd: 'C:\\Users\\ADMIN\\Downloads\\telegramReport\\telegramReport',
      env: {
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
    },
    {
      name: 'kpi-bot',
      script: 'apps/bot/index.js',
      cwd: 'C:\\Users\\ADMIN\\Downloads\\telegramReport\\telegramReport',
      env: {
        NODE_OPTIONS: '--dns-result-order=ipv4first',
      },
      watch: false,
      autorestart: true,
      max_restarts: 10,
    },
  ],
};
