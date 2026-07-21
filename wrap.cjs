const fs = require('fs');
let code = fs.readFileSync('apps/bot/kpi_features.js', 'utf8');

// Remove original bot init
code = code.replace(/const bot = new Telegraf\(.*?\);/, '');
code = code.replace(/const botApp = express\(\);/, '');
code = code.replace(/botApp\.listen\(3002[\s\S]*$/, '');
code = code.replace(/bot\.use\(stage\.middleware\(\)\);/, '');
code = code.replace(/const stage = new Scenes\.Stage\(\[reportWizard, setupWizard\]\);/, '');

// Find the line after let sheetQueue
const match = code.match(/let sheetQueue = Promise\.resolve\(\);/);
if (match) {
    const idx = match.index + match[0].length;
    let top = code.substring(0, idx);
    let bottom = code.substring(idx);
    
    // Wrap bottom
    let wrapped = `\n\nexport function setupKpiBot(bot, botApp) {\n` + bottom + `\n}\n`;
    fs.writeFileSync('apps/bot/kpi_features.js', top + wrapped);
    console.log('Wrapped successfully');
} else {
    console.log('Could not find sheetQueue');
}
