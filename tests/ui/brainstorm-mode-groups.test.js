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
  assert.match(wxml, /class="mode-cover"[^>]*mode="aspectFit"/);
});

test('选择模式页的四张卡片和底部操作区在同一屏内排布', () => {
  const wxml = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.wxml'
  ), 'utf8');
  const wxss = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.wxss'
  ), 'utf8');

  assert.doesNotMatch(wxml, /<scroll-view/);
  assert.match(wxml, /<page-footer[\s\S]*?fixed="\{\{false\}\}"/);
  assert.match(wxss, /\.container\s*\{[\s\S]*?height:\s*100vh;[\s\S]*?overflow:\s*hidden;/);
  assert.match(wxss, /\.mode-scroll\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;/);
  assert.doesNotMatch(wxss, /\.mode-groups\s*\{[^}]*justify-content:\s*space-between;/);
  assert.match(wxss, /\.mode-group\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(wxss, /\.mode-list\s*\{[\s\S]*?flex:\s*0 0 auto;/);
  assert.match(wxss, /\.mode-item\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?height:\s*176rpx;[\s\S]*?padding:\s*10rpx 24rpx;/);
  assert.match(wxss, /\.mode-cover\s*\{[\s\S]*?width:\s*144rpx;[\s\S]*?height:\s*144rpx;/);
  assert.match(wxss, /\.mode-name\s*\{[\s\S]*?font-size:\s*38rpx;/);
  assert.match(wxss, /\.mode-desc\s*\{[\s\S]*?font-size:\s*26rpx;/);
  assert.match(wxss, /\.footer\s*\{[\s\S]*?background:\s*transparent;/);
  assert.match(wxss, /@media screen and \(max-height:\s*700px\)[\s\S]*?\.mode-item\s*\{[\s\S]*?height:\s*152rpx;/);
});

test('房主打开模式选择前先提交权威状态，返回时也执行投影后退', () => {
  const lobbySource = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/addPlayer/index.js'
  ), 'utf8');
  const modeSource = fs.readFileSync(path.resolve(
    __dirname,
    '../../pages/main-pages/brainstormMode/index.js'
  ), 'utf8');

  assert.match(lobbySource, /dispatchRoomCommand\('BEGIN_MODE_SELECTION'/);
  assert.match(lobbySource, /followRoomRouteAfterCommand\(result, roomId\)/);
  assert.match(modeSource, /executeProjectedBack\(this\.data\.roomId\)/);
});
