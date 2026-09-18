'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sceneFromWorkflowStep,
  sceneFromMemberView,
  getSceneUI,
  resolveSubScreenNavigation
} = require('../../utils/subAwaitRoutes');

test('subAwait 按 workflow.step 映射等待场景', () => {
  assert.equal(sceneFromWorkflowStep('CHOOSE_SCENARIO'), 'bg');
  assert.equal(sceneFromWorkflowStep('SELECT_DESIGN_PROBLEM'), 'selectProblem');
  assert.equal(sceneFromWorkflowStep('SELECT_FIRST_PLAYER'), 'player');
  assert.equal(sceneFromWorkflowStep('CONFIRM_FIRST_PLAYER'), 'confirmFirstPlayer');
  assert.equal(getSceneUI('selectProblem').mainText, '等待房主选择设计问题');
  assert.equal(getSceneUI('player').mainText, '等待房主抽取首位翻牌玩家');
  ['bg', 'player', 'selectProblem', 'confirmFirstPlayer', 'mode', 'brainstormMode'].forEach((scene) => {
    assert.equal(getSceneUI(scene).useHeroLayout, true, `${scene} 必须使用 hero 等待样式`);
  });
});

test('subAwait 优先使用 view.route.params.scene，其次 phase/step', () => {
  assert.equal(sceneFromMemberView({
    route: { name: 'subAwait', params: { scene: 'player', phase: 'CHOOSE_SCENARIO' } },
    session: { workflow: { step: 'CHOOSE_SCENARIO' } }
  }), 'player');
  assert.equal(sceneFromMemberView({
    route: { name: 'subAwait', params: { phase: 'SELECT_FIRST_PLAYER' } },
    session: { workflow: { step: 'SELECT_FIRST_PLAYER' } }
  }), 'player');
  assert.equal(sceneFromMemberView({
    route: { name: 'subAwait', params: {} },
    session: { workflow: { step: 'SELECT_DESIGN_PROBLEM' } }
  }, 'bg'), 'selectProblem');
  assert.equal(sceneFromMemberView({
    route: { name: 'subAwait', params: { scene: 'confirmFirstPlayer', phase: 'CONFIRM_FIRST_PLAYER' } },
    session: { workflow: { step: 'CONFIRM_FIRST_PLAYER' } }
  }), 'confirmFirstPlayer');
});

test('等待页源码在权威 route 离开 subAwait 后不再刷情境空状态', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../../pages/sub-pages/subAwait/index.js'), 'utf8');
  assert.match(source, /routeName !== 'subAwait'/);
  assert.match(source, /_sceneFromSnapshot/);
});

test('确认首位时非房主走 subAwait，房主才进入 confirmFirstPlayer 页', () => {
  const previousGetApp = global.getApp;
  global.getApp = () => ({ globalData: {} });
  try {
    const guest = resolveSubScreenNavigation('confirmFirstPlayer', {}, '12345678', { isHost: false });
    assert.equal(guest.action, 'await');
    assert.equal(guest.scene, 'confirmFirstPlayer');
    const host = resolveSubScreenNavigation('confirmFirstPlayer', {}, '12345678', { isHost: true });
    assert.equal(host.action, 'redirect');
    assert.match(host.url, /confirmFirstPlayer/);
  } finally {
    global.getApp = previousGetApp;
  }
});
