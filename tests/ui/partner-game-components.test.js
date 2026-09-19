'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function loadComponent(relativePath) {
  const modulePath = path.resolve(__dirname, '../..', relativePath);
  const original = global.Component;
  let definition;
  global.Component = (value) => { definition = value; };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  delete require.cache[require.resolve(modulePath)];
  global.Component = original;
  return definition;
}

function componentInstance(definition, data = {}) {
  const events = [];
  return {
    data: { ...(definition.data || {}), ...data },
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
    events,
    ...definition.methods
  };
}

test('灵感输入模块通过小接口输出语义事件，不持有 RoomSession', () => {
  const definition = loadComponent('components/partner-inspiration-composer/index.js');
  const component = componentInstance(definition);

  component.onInput({ detail: { value: '新的灵感' } });
  component.onKeyboardHeightChange({ detail: { height: 320 } });
  component.onActionTap();
  component.onRemovePhoto({ currentTarget: { dataset: { index: 2 } } });

  assert.deepEqual(component.events, [
    { name: 'input', detail: { value: '新的灵感' } },
    { name: 'keyboardheightchange', detail: { height: 320 } },
    { name: 'action', detail: {} },
    { name: 'removephoto', detail: { index: 2 } }
  ]);
  assert.doesNotMatch(read('components/partner-inspiration-composer/index.js'), /room-session|dispatchRoomCommand|getApp\(/);
});

test('游戏底栏模块只输出业务意图，不执行命令或页面导航', () => {
  const definition = loadComponent('components/partner-game-footer/index.js');
  const component = componentInstance(definition);

  component.emitIntent({ currentTarget: { dataset: { intent: 'START_STATEMENT' } } });
  assert.deepEqual(component.events, [{
    name: 'intent',
    detail: { type: 'START_STATEMENT' }
  }]);

  const source = read('components/partner-game-footer/index.js');
  assert.doesNotMatch(source, /dispatchRoomCommand|wx\.(?:navigate|redirect|reLaunch)/);
});

test('收尾投票屏幕只发出 vote 意图，Shell 负责提交 V3 Command', () => {
  const definition = loadComponent('components/partner-closing-vote-screen/index.js');
  const component = componentInstance(definition, {
    model: { hasVoted: false, isInitiator: false },
    submitting: false
  });

  component.onVoteTap({ currentTarget: { dataset: { vote: 'pass' } } });
  assert.deepEqual(component.events, [{ name: 'vote', detail: { vote: 'pass' } }]);
  assert.doesNotMatch(read('components/partner-closing-vote-screen/index.js'), /room-session|dispatchRoomCommand|getApp\(/);
});

test('等待屏幕是只消费 Shell Model 的无状态组件，不持有订阅或导航', () => {
  const definition = loadComponent('components/room-wait-screen/index.js');
  assert.equal(definition.properties.model.type, Object);

  const source = read('components/room-wait-screen/index.js');
  assert.doesNotMatch(source, /room-session|bindPageToRoomSession|getApp\(|wx\.(?:navigate|redirect|reLaunch)/);
});

test('游戏页头只输出返回、房间和情境语义意图', () => {
  const definition = loadComponent('components/partner-game-header/index.js');
  const component = componentInstance(definition);

  component.emitIntent({ currentTarget: { dataset: { intent: 'OPEN_ROOM' } } });
  component.emitIntent({ currentTarget: { dataset: { intent: 'VIEW_SITUATION' } } });
  assert.deepEqual(component.events, [
    { name: 'intent', detail: { type: 'OPEN_ROOM' } },
    { name: 'intent', detail: { type: 'VIEW_SITUATION' } }
  ]);
  assert.doesNotMatch(read('components/partner-game-header/index.js'), /room-session|wx\.(?:navigate|redirect|reLaunch)/);
});

test('玩家条只转发头像和计时事件，不持有业务状态机', () => {
  const definition = loadComponent('components/partner-player-strip/index.js');
  const component = componentInstance(definition);

  component.onAvatarTap({ detail: { index: 2 } });
  component.onTimerExpire({ detail: { key: '1-2' } });
  assert.deepEqual(component.events, [
    { name: 'avatartap', detail: { index: 2 } },
    { name: 'timerexpire', detail: { key: '1-2' } }
  ]);
  assert.doesNotMatch(read('components/partner-player-strip/index.js'), /room-session|dispatchRoomCommand|getApp\(/);
});

test('gamepage 由低耦合模块拼接，并让 RoomShell 屏幕选择包住原有游戏内容', () => {
  const markup = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const config = JSON.parse(read('pages/main-pages/partnerMode/gamepage/index.json'));

  assert.match(markup, /<partner-closing-vote-screen/);
  assert.match(markup, /<room-wait-screen/);
  assert.match(markup, /<partner-game-header/);
  assert.match(markup, /<partner-player-strip/);
  assert.match(markup, /<partner-inspiration-composer/);
  assert.match(markup, /<partner-game-footer/);
  assert.match(markup, /roomShellScreen === 'closingVote'/);
  assert.match(markup, /roomShellScreen === 'waiting'/);
  assert.equal(config.usingComponents['partner-closing-vote-screen'], '/components/partner-closing-vote-screen/index');
  assert.equal(config.usingComponents['room-wait-screen'], '/components/room-wait-screen/index');
  assert.equal(config.usingComponents['partner-game-header'], '/components/partner-game-header/index');
  assert.equal(config.usingComponents['partner-player-strip'], '/components/partner-player-strip/index');
  assert.equal(config.usingComponents['partner-inspiration-composer'], '/components/partner-inspiration-composer/index');
  assert.equal(config.usingComponents['partner-game-footer'], '/components/partner-game-footer/index');
});
