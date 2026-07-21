import fs from 'fs';

// 1. Patch schedule.html to append groupId to all fetch calls
let html = fs.readFileSync('apps/bot/public/schedule.html', 'utf8');

// Add a helper function to get chat_id from URL
const helperJs = `
        function getGroupId() {
            var urlParams = new URLSearchParams(window.location.search);
            return urlParams.get('chat_id') || '';
        }
`;
html = html.replace(/<script>/, '<script>' + helperJs);

// Replace fetch('/api/schedules?date=' + date)
html = html.replace(
    /fetch\('\/api\/schedules\?date=' \+ date\)/g,
    "fetch('/api/schedules?date=' + date + '&groupId=' + getGroupId())"
);

// Replace fetch('/api/schedules/search?phone=' + encodeURIComponent(phone))
html = html.replace(
    /fetch\('\/api\/schedules\/search\?phone=' \+ encodeURIComponent\(phone\)\)/g,
    "fetch('/api/schedules/search?phone=' + encodeURIComponent(phone) + '&groupId=' + getGroupId())"
);

fs.writeFileSync('apps/bot/public/schedule.html', html, 'utf8');
console.log('Patched schedule.html');

// 2. Patch index.js GET /api/schedules and GET /api/schedules/search to filter by group_id
let indexJs = fs.readFileSync('apps/bot/index.js', 'utf8');

indexJs = indexJs.replace(
    /const \{ date \} = req\.query; \/\/ YYYY-MM-DD\s+const result = await pool\.query\(\s+`SELECT id, employee_name, customer_name, phone, service, appointment_time, status, cancel_reason\s+FROM customer_appointments \s+WHERE DATE\(appointment_time\) = \$1 AND status = 'ACTIVE'/g,
    `const { date, groupId } = req.query; // YYYY-MM-DD
        const result = await pool.query(
            \`SELECT id, employee_name, customer_name, phone, service, appointment_time, status, cancel_reason
             FROM customer_appointments 
             WHERE DATE(appointment_time) = $1 AND status = 'ACTIVE' AND (group_id = $2 OR group_id IS NULL OR $2 = '')`
);

indexJs = indexJs.replace(
    /botApp\.get\('\/api\/schedules\/search', async \(req, res\) => {\s+try {\s+const \{ phone \} = req\.query;\s+const result = await pool\.query\(\s+`SELECT id, employee_name, customer_name, phone, service, appointment_time, status, cancel_reason\s+FROM customer_appointments \s+WHERE phone = \$1 AND status = 'ACTIVE'/g,
    `botApp.get('/api/schedules/search', async (req, res) => {
    try {
        const { phone, groupId } = req.query;
        const result = await pool.query(
            \`SELECT id, employee_name, customer_name, phone, service, appointment_time, status, cancel_reason
             FROM customer_appointments 
             WHERE phone = $1 AND status = 'ACTIVE' AND (group_id = $2 OR group_id IS NULL OR $2 = '')`
);

fs.writeFileSync('apps/bot/index.js', indexJs, 'utf8');
console.log('Patched index.js');
