'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function loadPageDefinition() {
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  global.getApp = () => ({ globalData: {} });
  const modulePath = '../../pages/main-pages/brainstormMode/index';
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return definition;
}

test('选择模式页按组件卡和模板卡分组，并保持指定顺序', () => {
  const definition = loadPageDefinition();
  assert.deepEqual(
    definition.data.modeGroups.map((group) => ({
      title: group.title,
      modes: group.modes.map((mode) => mode.id)
    })),
    [
      { title: '组件卡', modes: ['ganDengYan', 'partner'] },
      { title: '模板卡', modes: ['spy', 'halliGalli'] }
    ]
  );

  const wxml = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.wxml'
  ), 'utf8');
  assert.match(wxml, /wx:for="\{\{modeGroups\}\}"/);
  assert.match(wxml, /class="mode-group-title"[^>]*>\{\{group\.title\}\}/);
  assert.match(wxml, /wx:for="\{\{group\.modes\}\}"/);
});
