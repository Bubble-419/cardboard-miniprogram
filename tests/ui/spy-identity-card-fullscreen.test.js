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
