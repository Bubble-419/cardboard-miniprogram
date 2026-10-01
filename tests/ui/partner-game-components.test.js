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

test('灵感输入模块留在正常布局流，键盘高度交给页面可用视口处理', () => {
  const definition = loadComponent('components/partner-inspiration-composer/index.js');
  const source = read('components/partner-inspiration-composer/index.js');
  const markup = read('components/partner-inspiration-composer/index.wxml');

  assert.equal(definition.observers, undefined);
  assert.doesNotMatch(source, /buildKeyboard(?:Bottom|Lift)Style/);
  assert.doesNotMatch(markup, /keyboardLiftStyle/);
  assert.match(markup, /keyboardHeight > 0 \? 'inspiration-bar-keyboard-open'/);
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

test('收尾阶段卡片与游戏阶段卡片使用一致的左右宽度', () => {
  const markup = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const styles = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  const swiperItemRule = styles.match(/^\.card-swiper-item\s*\{[\s\S]*?\n\}/m);
  const closingStageRule = styles.match(/\.closing-card-stage\s*\{[\s\S]*?\n\}/);

  assert.match(markup, /previous-margin="24rpx"/);
  assert.match(markup, /next-margin="24rpx"/);
  assert.ok(swiperItemRule);
  assert.match(swiperItemRule[0], /padding:\s*0 6rpx;/);
  assert.ok(closingStageRule);
  assert.match(closingStageRule[0], /padding:\s*0 30rpx 8rpx;/);
});

test('声音过大提示在游戏卡片中央放大显示', () => {
  const markup = read('components/game-card-timer/index.wxml');
  const styles = read('components/game-card-timer/index.wxss');
  const warning = styles.match(/\.gct-sound-warn\s*\{[\s\S]*?\n\}/);

  assert.match(markup, /gct-sound-warn[\s\S]*?声音过大，请降低音量/);
  assert.ok(warning);
  assert.match(warning[0], /top:\s*50%;/);
  assert.match(warning[0], /left:\s*50%;/);
  assert.match(warning[0], /transform:\s*translate\(-50%,\s*-50%\);/);
  assert.match(warning[0], /font-size:\s*(?:3[6-9]|[4-9]\d)rpx;/);
});

test('静默模式边缘对声音变化提供清晰的长度、粗细和光晕反馈', () => {
  const source = read('components/game-card-timer/index.js');

  assert.match(source, /const SOUND_EASE_MS = 180;/);
  assert.match(source, /const SOUND_BAND_MIN_WIDTH_RPX = 7;/);
  assert.match(source, /const SOUND_BAND_MAX_WIDTH_RPX = 10;/);
  assert.match(source, /SOUND_BAND_MAX_WIDTH_RPX - SOUND_BAND_MIN_WIDTH_RPX\) \* progress/);
  assert.match(source, /\{ w: lineWidth \* 4, a: 0\.2 \}/);
  assert.match(source, /alpha \*= 1 - 0\.55 \* fadeT \* fadeT;/);
  assert.match(source, /const SOUND_WARN_DB = 40;/);
});

test('键盘缩短卡片时按实际尺寸重建倒计时画布', () => {
  const markup = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const definition = loadComponent('components/game-card-timer/index.js');
  const source = read('components/game-card-timer/index.js');
  const cardTimers = markup.match(/<game-card-timer[\s\S]*?>/g) || [];
  const currentCardTimers = cardTimers.filter((tag) => /timerActive="\{\{roundTimerVisible/.test(tag));

  assert.equal(currentCardTimers.length, 2);
  currentCardTimers.forEach((tag) => {
    assert.match(tag, /layoutKey="\{\{keyboardViewportStyle\}\}"/);
  });
  assert.ok(definition.properties.layoutKey);
  assert.equal(typeof definition.observers.layoutKey, 'function');
  assert.match(source, /layoutKey\(\)\s*\{\s*this\._scheduleCanvasResize\(\);/);
  assert.match(source, /this\._canvasResizeTimer\s*=\s*setTimeout/);
});

test('Partner 头像裁切层和圆环使用明确的共同圆心', () => {
  const styles = read('components/user-list/index.wxss');
  const avatarWrap = styles.match(/\.partner-game \.avatar-frame-box-pg \.avatar-wrap,[\s\S]*?\n\}/);
  const avatarImage = styles.match(/\.partner-game \.avatar-frame-box-pg \.avatar-img,[\s\S]*?\n\}/);

  assert.ok(avatarWrap);
  assert.match(avatarWrap[0], /position:\s*absolute;/);
  assert.match(avatarWrap[0], /left:\s*4rpx;/);
  assert.match(avatarWrap[0], /top:\s*4rpx;/);
  assert.match(avatarWrap[0], /clip-path:\s*circle\(50% at 50% 50%\);/);
  assert.ok(avatarImage);
  assert.match(avatarImage[0], /border-radius:\s*inherit;/);
  assert.match(avatarImage[0], /clip-path:\s*circle\(50% at 50% 50%\);/);
});
