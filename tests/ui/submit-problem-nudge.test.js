'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = {
  globalData: {
    roomId: '12345678',
    gameMode: 'partner',
    roomSession: {
      getRequestContext: () => ({ deviceSessionId: 'device-1', touchPresence: false })
    }
  }
};

global.getApp = () => app;

function loadPageDefinition(modulePath) {
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return definition;
}

function makePage(definition, data = {}) {
  return {
    ...definition,
    data: {
      ...definition.data,
      ...data
    },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

test('已提交者点击催促后按钮立刻变灰，冷却期内不再发信号', async () => {
  const calls = [];
  global.wx = {
    showToast() {},
    nextTick(fn) { fn(); },
    cloud: {
      async callFunction(request) {
        calls.push(request);
        return { result: { ok: true, signal: { updatedAt: 11 } } };
      }
    }
  };
  const definition = loadPageDefinition('../../pages/main-pages/submitProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: 'session-1',
    hasSubmitted: true,
    submittedCount: 1,
    totalMembers: 3,
    showNudgeButton: true
  });
  page._pageAlive = true;

  await page.nudgeUnsubmittedPlayers();
  await page.nudgeUnsubmittedPlayers();

  assert.equal(page.data.nudgeDisabled, true);
  assert.equal(page.data.nudgeCooldownLeft, 15);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'roomSignal');
  assert.equal(calls[0].data.signalType, 'DESIGN_PROBLEM_NUDGE');
  assert.equal(calls[0].data.sessionId, 'session-1');
  assert.equal(calls[0].data.turnId, undefined);
  page.onUnload();
});

test('催促失败时恢复可点，未提交者仅在 updatedAt 变化时抖动并显示内联提示', async () => {
  global.wx = {
    showToast() {},
    nextTick(fn) { fn(); },
    cloud: {
      async callFunction() {
        return { result: { ok: false, errMsg: '当前不能催促提交设计问题' } };
      }
    }
  };
  const definition = loadPageDefinition('../../pages/main-pages/submitProblem/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: 'session-1',
    hasSubmitted: true,
    submittedCount: 1,
    totalMembers: 3,
    showNudgeButton: true,
    inputNudgeShake: false,
    showNudgeHint: false
  });
  page._pageAlive = true;

  await page.nudgeUnsubmittedPlayers();
  assert.equal(page.data.nudgeDisabled, false);
  assert.equal(page.data.nudgeCooldownLeft, 0);

  page.setData(page._withNudgeVisibility({
    hasSubmitted: false,
    submittedCount: 1,
    totalMembers: 3
  }));
  assert.equal(page.data.showNudgeButton, false);

  page._applyNudgeSignal({
    signals: { DESIGN_PROBLEM_NUDGE: { updatedAt: 2000 } }
  }, false);
  assert.equal(page.data.inputNudgeShake, true);
  assert.equal(page.data.showNudgeHint, true);
  assert.equal(page.data.nudgeHintFading, false);

  page.setData({ inputNudgeShake: false, showNudgeHint: false });
  page._applyNudgeSignal({
    signals: { DESIGN_PROBLEM_NUDGE: { updatedAt: 2000 } }
  }, false);
  assert.equal(page.data.inputNudgeShake, false);
  assert.equal(page.data.showNudgeHint, false);

  page._applyNudgeSignal({
    signals: { DESIGN_PROBLEM_NUDGE: { updatedAt: 2000 } }
  }, true);
  assert.equal(page.data.inputNudgeShake, false);
  assert.equal(page.data.showNudgeHint, false);
  page.onUnload();
});

test('提交问题页模板包含催促按钮、输入框抖动和内联提示', () => {
  const wxml = fs.readFileSync(
    path.join(__dirname, '../../pages/main-pages/submitProblem/index.wxml'),
    'utf8'
  );
  assert.match(wxml, /bindtap="nudgeUnsubmittedPlayers"/);
  assert.match(wxml, /催促其他人/);
  assert.match(wxml, /form-input-wrap-nudge/);
  assert.match(wxml, /小伙伴在催你提交啦/);
  assert.match(wxml, /form-input-wrap[\s\S]*nudge-hint/);

  const hintIndex = wxml.indexOf('class="nudge-hint');
  const textareaIndex = wxml.indexOf('class="textarea-box"');
  assert.ok(hintIndex > -1 && hintIndex < textareaIndex, '催促提示应位于输入框上方');

  const wxss = fs.readFileSync(
    path.join(__dirname, '../../pages/main-pages/submitProblem/index.wxss'),
    'utf8'
  );
  const hintRule = wxss.match(/\.nudge-hint\s*\{[\s\S]*?\}/);
  assert.ok(hintRule);
  assert.match(hintRule[0], /position:\s*absolute;/);
  assert.match(hintRule[0], /bottom:\s*100%;/);
  assert.match(hintRule[0], /justify-content:\s*flex-end;/);
});

test('设计问题输入框使用紧凑高度并保留底部操作区', () => {
  const wxss = fs.readFileSync(
    path.join(__dirname, '../../pages/main-pages/submitProblem/index.wxss'),
    'utf8'
  );
  const inputRule = wxss.match(/\.problem-input\s*\{[\s\S]*?\}/);
  const boxRule = wxss.match(/\.textarea-box\s*\{[\s\S]*?\}/);

  assert.ok(inputRule);
  assert.match(inputRule[0], /height:\s*220rpx;/);
  assert.ok(boxRule);
  assert.match(boxRule[0], /padding-bottom:\s*96rpx;/);
});
