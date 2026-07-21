import fs from 'fs';

let content = fs.readFileSync('apps/bot/index.js', 'utf8');

// Patch 1: /api/schedules/cancel
content = content.replace(
    /UPDATE customer_appointments SET status = 'CANCELLED', cancel_reason = \$1 WHERE id = \$2 RETURNING sheet_row_index, employee_name/g,
    "UPDATE customer_appointments SET status = 'CANCELLED', cancel_reason = $1 WHERE id = $2 RETURNING sheet_row_index, employee_name, group_id"
);
content = content.replace(
    /const empName = dbRes\.rows\[0\]\?\.employee_name;\s+if \(rowIndex && customerDoc\) {/g,
    `const empName = dbRes.rows[0]?.employee_name;\n        const groupId = dbRes.rows[0]?.group_id;\n        const customerDoc = await getCustomerDocForGroup(groupId);\n        if (rowIndex && customerDoc) {`
);

// Patch 2: /api/schedules/complete
content = content.replace(
    /UPDATE customer_appointments SET status = 'COMPLETED', revenue = \$1 WHERE id = \$2 RETURNING sheet_row_index, employee_name/g,
    "UPDATE customer_appointments SET status = 'COMPLETED', revenue = $1 WHERE id = $2 RETURNING sheet_row_index, employee_name, group_id"
);

// Patch 3: /api/schedules/no-show
content = content.replace(
    /UPDATE customer_appointments SET status = 'NO_SHOW', is_reminded = TRUE WHERE id = \$1 RETURNING sheet_row_index, employee_name/g,
    "UPDATE customer_appointments SET status = 'NO_SHOW', is_reminded = TRUE WHERE id = $1 RETURNING sheet_row_index, employee_name, group_id"
);

// Other patches... Let's use a generic regex for RETURNING sheet_row_index, employee_name
content = content.replace(
    /RETURNING sheet_row_index, employee_name/g,
    "RETURNING sheet_row_index, employee_name, group_id"
);

fs.writeFileSync('apps/bot/index.js', content, 'utf8');
console.log('Patched customer endpoints successfully');
