import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const entry = fs.readFileSync(new URL('../timekeep_bot.js', import.meta.url), 'utf8');

test('timekeep_bot.js chỉ còn bootstrap và lắp ghép module', () => {
    for (const registrar of [
        'registerGroupSyncMiddleware',
        'createTelegramMiniAppAuth',
        'configureBotHttp',
        'registerStartCommands',
        'registerBusinessModules',
        'startBotRuntime'
    ]) assert.match(entry, new RegExp(`${registrar}\\(`), registrar);

    assert.ok(entry.split('\n').length < 220, 'entry point bot không được phình lại thành god file');
    assert.doesNotMatch(entry, /async function startHandler/);
    assert.doesNotMatch(entry, /async function authenticateTelegramMiniApp/);
    assert.equal(fs.existsSync(new URL('../index.js', import.meta.url)), false, 'không phục hồi entry point legacy');
});

test('thứ tự đăng ký handler Telegraf không thay đổi', () => {
    const commands = entry.indexOf('registerStartCommands({');
    const runtime = entry.indexOf('startBotRuntime({');
    const business = entry.indexOf('registerBusinessModules({');
    assert.ok(commands > 0 && commands < runtime && runtime < business);
});
