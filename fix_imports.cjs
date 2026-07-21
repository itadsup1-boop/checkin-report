const fs = require('fs');
let code = fs.readFileSync('apps/bot/kpi_features.js', 'utf8');

// Remove unwanted imports
code = code.replace(/import \{ session, Scenes \} from 'telegraf';\n/, '');
code = code.replace(/import \{ reportWizard \} from '\.\/reportWizard\.js';\n/, '');
code = code.replace(/import \{ setupWizard \} from '\.\/setupWizard\.js';\n/, '');
code = code.replace(/import express from 'express';\n/, '');
code = code.replace(/import cors from 'cors';\n/, '');

// Add express and cors to the top
const imports = "import express from 'express';\nimport cors from 'cors';\n";
code = imports + code;

fs.writeFileSync('apps/bot/kpi_features.js', code);
console.log('Fixed imports');
