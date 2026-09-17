'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sceneFromWorkflowStep,
  sceneFromMemberView,
  getSceneUI
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
});
