const fs = require('fs');
let code = fs.readFileSync('apps/bot/timekeep_bot.js', 'utf8');

// 1. Replace table names
code = code.replace(/tk_groups/g, 'telegram_groups');
code = code.replace(/tk_users/g, 'employees');

// 2. Fix JOINs for employees and telegram_groups
// Old: JOIN telegram_groups g ON u.group_id = g.id
// New: JOIN telegram_groups g ON u.telegram_group_id = g.telegram_group_id
code = code.replace(/ON u\.group_id = g\.id/g, 'ON u.telegram_group_id = g.telegram_group_id');
code = code.replace(/ON u\.id = r\.user_id/g, 'ON u.id = r.user_id'); // Just making sure
// In timekeep_bot.js line 1428: JOIN employees u ON c.user_id = u.id -> Fine
// Line 1230: JOIN employees u ON r.user_id = u.id -> Fine

// 3. Fix INSERT INTO employees
// Old: 'INSERT INTO employees (group_id, telegram_id, full_name, role) VALUES ($1, $2, $3, $4)'
// New: 'INSERT INTO employees (telegram_group_id, telegram_id, full_name, role) VALUES ($1, $2, $3, $4)'
// And we need to make sure the $1 being passed is the varchar, not the uuid!
// But wait, in register:
// let groupRes = await pool.query('SELECT id FROM telegram_groups WHERE telegram_group_id = $1', [telegram_group_id]);
// let groupId = groupRes.rows[0].id;
// userRes = await pool.query('SELECT id FROM employees WHERE group_id = $1 AND telegram_id = $2', [groupId, telegram_id]);
// If I just change it to:
code = code.replace(/WHERE group_id = \$1 AND telegram_id = \$2/g, 'WHERE telegram_group_id = $1 AND telegram_id = $2');
code = code.replace(/\[groupId, telegram_id\]/g, '[telegram_group_id, telegram_id]');
code = code.replace(/\(group_id, telegram_id, full_name, role\)/g, '(telegram_group_id, telegram_id, full_name, role)');
code = code.replace(/WHERE group_id = \$1 ORDER BY full_name ASC/g, 'WHERE telegram_group_id = $1 ORDER BY full_name ASC');
// For schedules list:
// `SELECT id, full_name, role, telegram_id FROM employees WHERE telegram_group_id = $1 ORDER BY full_name ASC`
// Wait, the parameter passed is [groupId]. We need to pass telegram_group_id.
// But earlier in that route:
// const groupRes = await pool.query('SELECT telegram_group_id FROM telegram_groups WHERE id = $1', [groupId]);
// const tgGroupId = groupRes.rows[0].telegram_group_id;
// We should replace [groupId] with [tgGroupId] in that specific query!
code = code.replace(/WHERE group_id = \$1 ORDER BY full_name ASC\`, \[groupId\]/g, 'WHERE telegram_group_id = $1 ORDER BY full_name ASC`, [tgGroupId]');

// In /api/timekeep/personal-stats:
// const userRes = await pool.query('SELECT group_id FROM employees WHERE id = $1', [user_id]);
// Should become telegram_group_id
code = code.replace(/SELECT group_id FROM employees/g, 'SELECT telegram_group_id FROM employees');
code = code.replace(/const groupId = userRes\.rows\[0\]\.group_id;/g, 'const groupId = userRes.rows[0].telegram_group_id;'); // Wait, if we do this, groupId is now varchar!
// Let's see if groupId is used to query tk_reports which expects UUID group_id?
// YES! tk_reports expects UUID for group_id. So if we change it, it breaks.
// IT IS MUCH SAFER TO JUST ADD group_id (UUID) to employees!
console.log('Done');
