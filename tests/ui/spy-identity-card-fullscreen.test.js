'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function loadComponent() {
  const originalComponent = global.Component;
  let definition;
  global.Component = (value) => { definition = value; };
  const modulePath = require.resolve('../../packageSpy/components/flip-word-card/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Component = originalComponent;
  return definition;
}

function makeComponent(definition, data) {
  const events = [];
  const component = {
    data: { ...definition.data, ...data },
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
    events,
    ...definition.methods
  };
  return component;
}

test('开启全屏后单击只翻页，不立刻打开全屏', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const definition = loadComponent();
  const component = makeComponent(definition, {
    fullscreenOnAssigned: true,
    cardState: 'assignedWord',
    word: '海洋',
    assignedWordSrc: 'word.png',
    word1Src: 'word1.png',
    animating: false
  });
  const flips = [];
  component._flipTo = (next, dir) => { flips.push({ next, dir }); };

  try {
    component.onTap();
    assert.deepEqual(component.events, []);
    assert.deepEqual(flips, []);

    t.mock.timers.tick(280);
    assert.deepEqual(flips, [{ next: 'word1', dir: 'up' }]);
    assert.deepEqual(component.events, []);
  } finally {
    component._clearTimers();
  }
});

test('双击请求横屏全屏，并取消待执行的单击翻页', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const component = makeComponent(loadComponent(), {
    fullscreenOnAssigned: true,
    cardState: 'assignedWord',
    word: '海洋',
    assignedWordSrc: 'word.png',
    word1Src: 'word1.png',
    animating: false
  });
  const flips = [];
  component._flipTo = (next, dir) => { flips.push({ next, dir }); };

  try {
    component.onTouchStart({ changedTouches: [{ clientX: 100, clientY: 200 }] });
    component.onTouchEnd({ changedTouches: [{ clientX: 104, clientY: 203 }] });
    component.onTap();
    t.mock.timers.tick(120);
    component.onTouchStart({ changedTouches: [{ clientX: 100, clientY: 200 }] });
    component.onTouchEnd({ changedTouches: [{ clientX: 102, clientY: 201 }] });
    component.onTap();

    assert.equal(component.events.length, 1);
    assert.equal(component.events[0].name, 'fullscreen');
    assert.equal(component.events[0].detail.word, '海洋');
    assert.equal(component.events[0].detail.src, 'word.png');
    assert.equal(component.data.cardState, 'assignedWord');
    assert.deepEqual(flips, []);

    t.mock.timers.tick(280);
    assert.deepEqual(flips, [], '双击后不应再执行延迟单击翻页');
  } finally {
    component._clearTimers();
  }
});

test('上下滑动仍翻页，翻面动画期间不误开全屏', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const component = makeComponent(loadComponent(), {
    fullscreenOnAssigned: true,
    twoFaceOnly: true,
    cardState: 'assignedWord',
    assignedWordSrc: 'word.png',
    backSrc: 'back.png',
    word: '海洋'
  });
  try {
    component.onTouchStart({ changedTouches: [{ clientX: 100, clientY: 200 }] });
    component.onTouchEnd({ changedTouches: [{ clientX: 100, clientY: 260 }] });
    component.onTap();
    component.onTap();
    assert.deepEqual(component.events, []);
    t.mock.timers.tick(300);
    t.mock.timers.tick(30);
    t.mock.timers.tick(300);
    assert.equal(component.data.cardState, 'back');
    assert.equal(component.data.animating, false);

    component.onTouchStart({ changedTouches: [{ clientX: 100, clientY: 260 }] });
    component.onTouchEnd({ changedTouches: [{ clientX: 100, clientY: 200 }] });
    component.onTap();
    t.mock.timers.tick(300);
    t.mock.timers.tick(30);
    t.mock.timers.tick(300);
    assert.equal(component.data.cardState, 'assignedWord');
    assert.deepEqual(component.events, []);
  } finally {
    component._clearTimers();
  }
});

test('发言页将卡牌全屏做成本地横屏叠层，并提供明确关闭入口', () => {
  const markup = read('packageSpy/pages/speak/index.wxml');
  const source = read('packageSpy/pages/speak/index.js');
  const styles = read('packageSpy/pages/speak/index.wxss');

  assert.match(markup, /fullscreenOnAssigned="\{\{true\}\}"/);
  assert.match(markup, /bind:fullscreen="onOpenIdentityCardFullscreen"/);
  assert.match(markup, /wx:if="\{\{identityCardFullscreenOpen && identityCardFullscreen\}\}"/);
  assert.match(markup, /bindtap="onCloseIdentityCardFullscreen"/);
  assert.match(markup, /landscapeGestures="\{\{true\}\}"/);
  assert.match(markup, /initialCardState="\{\{identityCardFullscreen\.initialCardState\}\}"/);
  assert.match(markup, /identity-card-fullscreen-card/);
  assert.doesNotMatch(markup, /identity-card-fullscreen-image/);
  assert.match(source, /onOpenIdentityCardFullscreen\(/);
  assert.match(source, /onOpenLibraryCardFullscreen\(/);
  assert.match(source, /onCloseIdentityCardFullscreen\(/);
  assert.match(source, /identityCardFullscreen:\s*\{/);
  assert.match(styles, /\.identity-card-fullscreen-mask\s*\{[\s\S]*?position:\s*fixed;/);
  assert.match(styles, /\.identity-card-fullscreen-stage\s*\{[\s\S]*?rotate\(90deg\)/);
  assert.match(
    styles,
    /\.identity-card-fullscreen-card\s+flip-word-card\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/
  );
});

test('全屏叠层内左右滑按横屏视觉方向翻页', () => {
  const definition = loadComponent();
  const component = makeComponent(definition, {
    landscapeGestures: true,
    cardState: 'assignedWord',
    assignedWordSrc: 'word.png',
    word1Src: 'word1.png',
    backSrc: 'back.png',
    animating: false
  });
  const flips = [];
  component._flipTo = (next, dir) => { flips.push({ next, dir }); };

  component.onTouchStart({ changedTouches: [{ clientX: 100, clientY: 200 }] });
  component.onTouchEnd({ changedTouches: [{ clientX: 160, clientY: 204 }] });
  assert.deepEqual(flips, [{ next: 'word1', dir: 'up' }]);

  flips.length = 0;
  component.data.cardState = 'word1';
  component.onTouchStart({ changedTouches: [{ clientX: 160, clientY: 200 }] });
  component.onTouchEnd({ changedTouches: [{ clientX: 100, clientY: 204 }] });
  assert.deepEqual(flips, [{ next: 'assignedWord', dir: 'down' }]);
});

test('initialCardState 可指定全屏打开时的起始面', () => {
  const definition = loadComponent();
  const component = makeComponent(definition, {
    skipBack: true,
    initialCardState: 'word1',
    assignedWordSrc: 'word.png',
    word1Src: 'word1.png'
  });
  assert.equal(component._initialState(), 'word1');
  component.data.skipBack = false;
  component.data.initialCardState = 'assignedWord';
  assert.equal(component._initialState(), 'assignedWord');
});
