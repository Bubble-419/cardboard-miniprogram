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
  const modulePath = require.resolve('../../components/flip-word-card/index');
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

test('已揭示的身份卡再次点击会请求全屏，而不是把卡片翻回背面', () => {
  const definition = loadComponent();
  const component = makeComponent(definition, {
    fullscreenOnAssigned: true,
    cardState: 'assignedWord',
    word: '海洋',
    animating: false
  });

  component.onTap();

  assert.deepEqual(component.events, [{ name: 'fullscreen', detail: { word: '海洋' } }]);
  assert.equal(component.data.cardState, 'assignedWord');
});

test('身份卡真实 touchstart → touchend → tap 序列只打开一次全屏且不翻面', () => {
  const component = makeComponent(loadComponent(), {
    fullscreenOnAssigned: true,
    cardState: 'assignedWord',
    word: '海洋',
    animating: false
  });
  try {
    component.onTouchStart({ changedTouches: [{ clientX: 100, clientY: 200 }] });
    component.onTouchEnd({ changedTouches: [{ clientX: 104, clientY: 203 }] });
    component.onTap();

    assert.deepEqual(component.events, [{ name: 'fullscreen', detail: { word: '海洋' } }]);
    assert.equal(component.data.cardState, 'assignedWord');
    assert.equal(component.data.animating, false);
  } finally {
    component._clearTimers();
  }
});

test('系统未派发 tap 的轻微触摸也能打开身份卡全屏', () => {
  const component = makeComponent(loadComponent(), {
    fullscreenOnAssigned: true, cardState: 'assignedWord', word: '海洋'
  });
  try {
    component.onTouchStart({ changedTouches: [{ clientX: 100, clientY: 200 }] });
    component.onTouchMove({ changedTouches: [{ clientX: 104, clientY: 208 }] });
    component.onTouchEnd({ changedTouches: [{ clientX: 104, clientY: 208 }] });
    assert.deepEqual(component.events, [{ name: 'fullscreen', detail: { word: '海洋' } }]);
    assert.equal(component.data.animating, false);
  } finally {
    component._clearTimers();
  }
});

test('开启全屏功能后上下滑动仍翻面，翻面动画期间不误开全屏', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const component = makeComponent(loadComponent(), {
    fullscreenOnAssigned: true, twoFaceOnly: true, cardState: 'assignedWord',
    assignedWordSrc: 'word.png', backSrc: 'back.png', word: '海洋'
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
    component.onTap();
    assert.equal(component.events.length, 1);
  } finally {
    component._clearTimers();
  }
});

test('发言页将身份卡全屏做成本地叠层，并提供明确关闭入口', () => {
  const markup = read('packageSpy/pages/speak/index.wxml');
  const source = read('packageSpy/pages/speak/index.js');
  const styles = read('packageSpy/pages/speak/index.wxss');

  assert.match(markup, /fullscreenOnAssigned="\{\{true\}\}"/);
  assert.match(markup, /bind:fullscreen="onOpenIdentityCardFullscreen"/);
  assert.match(markup, /wx:if="\{\{identityCardFullscreenOpen\}\}"/);
  assert.match(markup, /bindtap="onCloseIdentityCardFullscreen"/);
  assert.match(source, /onOpenIdentityCardFullscreen\(\)/);
  assert.match(source, /onCloseIdentityCardFullscreen\(\)/);
  assert.match(styles, /\.identity-card-fullscreen-mask\s*\{[\s\S]*?position:\s*fixed;/);
});
