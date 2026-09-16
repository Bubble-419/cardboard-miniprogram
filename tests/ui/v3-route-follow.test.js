'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const banned = /followSubScreenRoomPoll\s*\(|followSpyRoomState\s*\(|openSubAwait\s*\(|navigateByRoomState\s*\(/;

function walk(relativeDir) {
  const absolute = path.join(root, relativeDir);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return walk(relative);
    return entry.name.endsWith('.js') ? [relative] : [];
  });
}

test('房间页不再用旧副屏跟随跳转，只消费 view.route', () => {
  const files = [
    ...walk('pages'),
    ...walk('packageSpy'),
    'utils/spyMode.js'
  ];
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, banned, `${file} 仍调用旧跟随跳转`);
  });
});

test('页面命令不自造 commandId，授权读取 actor.capabilities', () => {
  const session = fs.readFileSync(path.join(root, 'modules/room-session/index.js'), 'utf8');
  assert.doesNotMatch(session, /commandId:\s*input\.commandId/);
  assert.match(session, /view\.actor\.capabilities/);
  assert.match(session, /cap\.allowed !== true/);
  const spyMode = fs.readFileSync(path.join(root, 'utils/spyMode.js'), 'utf8');
  assert.doesNotMatch(spyMode, /makeSpyCommandId|commandIdFactory|clientCreateId/);
  const pages = [...walk('pages'), ...walk('packageSpy')];
  pages.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /commandId\s*:/, `${file} 仍生成 commandId`);
  });
});

test('倒计时不再用 SPEAK_ROUND_MS / VOTE_ROUND_MS 本地裁决', () => {
  const files = [
    ...walk('pages'),
    ...walk('packageSpy'),
    'utils/spyMode.js',
    'utils/spyGameState.js'
  ];
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /SPEAK_ROUND_MS|SPEAK_TURN_MS|VOTE_ROUND_MS|resolveWinnerSide/, `${file} 仍本地裁决时长或胜负`);
  });
});
