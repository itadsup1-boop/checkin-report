import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('./timekeep_bot.js', import.meta.url), 'utf8');
const handlerStart = source.indexOf('async function startHandler(ctx)');
const handlerEnd = source.indexOf('\nbot.start(startHandler)', handlerStart);
const startHandlerSource = source.slice(handlerStart, handlerEnd);

test('menu vẫn có tên nhóm nội bộ để cập nhật database', () => {
    assert.match(startHandlerSource, /const groupName = ctx\.chat\.title \|\| 'Nhóm làm việc';/);
    assert.match(startHandlerSource, /\[groupId, groupName\]/);
});

test('menu các role chỉ hiện lời mời chọn chức năng, không hiện dòng chào nhóm', () => {
    assert.doesNotMatch(startHandlerSource, /Xin chào các thành viên nhóm/);
    const prompts = startHandlerSource.match(/Vui lòng chọn chức năng:/g) || [];
    assert.equal(prompts.length, 5);
});
