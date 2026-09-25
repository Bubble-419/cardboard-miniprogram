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

test('游戏页灵感输入聚焦时向左覆盖入口并禁用入口点击', () => {
  const definition = loadComponent('components/partner-inspiration-composer/index.js');
  const component = componentInstance(definition, { keyboardHeight: 0 });
  const markup = read('components/partner-inspiration-composer/index.wxml');
  const styles = read('components/partner-inspiration-composer/index.wxss');

  assert.match(markup, /inputFocused \|\| keyboardHeight > 0 \? 'inspiration-composer-expanded'/);
  assert.match(markup, /inputFocused \|\| keyboardHeight > 0 \? 'insp-icon-wrap-disabled'/);
  assert.match(styles, /\.inspiration-bar\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(styles, /\.inspiration-composer\s*\{[\s\S]*?transition:\s*margin-left 240ms ease-out;/);
  assert.match(styles, /\.inspiration-composer-expanded\s*\{[\s\S]*?margin-left:\s*-110rpx;/);
  assert.match(styles, /\.insp-icon-wrap-disabled\s*\{\s*pointer-events:\s*none;/);

  component.onFocus({ detail: {} });
  component.onOpenCenter();
  assert.equal(component.data.inputFocused, true);
  assert.deepEqual(component.events, [{ name: 'focus', detail: {} }]);

  component.onBlur({ detail: {} });
  component.onOpenCenter();
  assert.equal(component.data.inputFocused, false);
  assert.deepEqual(component.events.slice(-2), [
    { name: 'blur', detail: {} },
    { name: 'opencenter', detail: {} }
  ]);
});

test('键盘仍打开时灵感空间入口保持禁用', () => {
  const definition = loadComponent('components/partner-inspiration-composer/index.js');
  const component = componentInstance(definition, {
    inputFocused: false,
    keyboardHeight: 300
  });

  component.onOpenCenter();

  assert.deepEqual(component.events, []);
});
