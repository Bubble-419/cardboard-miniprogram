'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');

test('Halli 从情境、首位、线下活动、全员创意到汇总和完成', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: {
    source: 'CUSTOM', scenario: { scene: '社区活动', user: '居民', function: '快速认识彼此' }
  } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_FIRST_PLAYER');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: '创意一' } });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: '创意二' } });
  snapshot = await h.snapshot('u2');
  assert.equal(snapshot.view.route.name, 'creativeSummary');
  assert.deepEqual(snapshot.view.session.publicModeState.ideas.map((item) => item.text), ['创意一', '创意二'],
    '已提交的创意应当在收集阶段向全员渐进公开');
  await h.command('u3', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: '创意三' } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_SUMMARY');
  assert.equal(snapshot.view.session.publicModeState.ideas.length, 3);
  await h.command('host', 'COMPLETE_HALLI_SESSION', { context: { sessionId } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.status, 'COMPLETED');
  assert.equal(snapshot.view.session.result.ideaCount, 3);
  assert.equal(snapshot.view.actor.capabilities.REOPEN_HALLI_IDEA.allowed, false);
  const reopenCompleted = await h.command('host', 'REOPEN_HALLI_IDEA', {
    context: { sessionId }
  });
  assert.equal(reopenCompleted.errCode, 'INVALID_TRANSITION');
});

test('干瞪眼跳过情境设置并复用 Halli 的线下活动、创意与汇总流程', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const started = await h.command('host', 'START_WORKSHOP_SESSION', {
    payload: { mode: 'GAN_DENG_YAN' }
  });
  assert.equal(started.ok, true);
  let snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.mode, 'GAN_DENG_YAN');
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_FIRST_PLAYER');
  assert.equal(snapshot.view.route.name, 'selectPlayer');
  assert.equal(snapshot.view.session.setup.scenario, null);
  assert.equal(snapshot.view.actor.capabilities.SET_SCENARIO.allowed, false);
  assert.equal(snapshot.view.actor.capabilities.RESET_SCENARIO.allowed, false);
  assert.equal(snapshot.view.navigation.back.commandType, 'CANCEL_WORKSHOP_SESSION');
  const playerSnapshot = await h.snapshot('u2');
  assert.deepEqual(playerSnapshot.view.route, {
    name: 'subAwait',
    params: { phase: 'SELECT_FIRST_PLAYER', scene: 'player' }
  });
  const sessionId = snapshot.view.session.sessionId;

  const scenarioAttempt = await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { source: 'OFFLINE' }
  });
  assert.equal(scenarioAttempt.errCode, 'INVALID_TRANSITION');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  assert.equal((await h.snapshot('u2')).view.route.name, 'halliGame');

  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '干瞪眼创意一' }
  });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '干瞪眼创意二' }
  });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_SUMMARY');
  assert.equal(snapshot.view.route.name, 'creativeSummary');
  assert.equal(snapshot.view.session.publicModeState.ideas.length, 2);

  const completed = await h.command('host', 'COMPLETE_HALLI_SESSION', {
    context: { sessionId }
  });
  assert.equal(completed.ok, true);
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.status, 'COMPLETED');
  assert.equal(snapshot.view.session.result.mode, 'GAN_DENG_YAN');

  const replay = await h.command('host', 'REPLAY_WORKSHOP_SESSION', { context: { sessionId } });
  assert.equal(replay.ok, true);
  snapshot = await h.snapshot('host');
  assert.notEqual(snapshot.view.session.sessionId, sessionId);
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_FIRST_PLAYER');
  assert.equal(snapshot.view.session.setup.scenarioSource, null);
  assert.equal(snapshot.view.session.setup.scenario, null);
  assert.equal(snapshot.view.route.name, 'selectPlayer');
});

test('Halli 已提交成员可在收集期和汇总期返回修改自己的创意', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  snapshot = await h.snapshot('host');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '初稿' }
  });

  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.route.name, 'creativeSummary');
  assert.equal(snapshot.view.actor.capabilities.REOPEN_HALLI_IDEA.allowed, true);
  let result = await h.command('host', 'REOPEN_HALLI_IDEA', { context: { sessionId } });
  assert.equal(result.ok, true);
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.route.name, 'creativeInput');
  assert.equal(snapshot.view.actor.contributionStatus.text, '初稿');
  assert.equal(snapshot.view.actor.capabilities.SUBMIT_HALLI_IDEA.allowed, true);

  result = await h.command('host', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '收集期修改稿' }
  });
  assert.equal(result.ok, true);
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.route.name, 'creativeSummary');
  assert.equal(snapshot.view.session.publicModeState.ideas
    .find((item) => item.memberId === snapshot.view.actor.memberId).text, '收集期修改稿');

  await h.command('u2', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意二' }
  });
  await h.command('u3', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '创意三' }
  });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_SUMMARY');

  result = await h.command('host', 'REOPEN_HALLI_IDEA', { context: { sessionId } });
  assert.equal(result.ok, true);
  assert.equal((await h.snapshot('host')).view.route.name, 'creativeInput');
  assert.equal((await h.snapshot('u2')).view.route.name, 'creativeSummary',
    '一名成员修改时不应改变其他成员的汇总页');
  const prematureComplete = await h.command('host', 'COMPLETE_HALLI_SESSION', {
    context: { sessionId }
  });
  assert.equal(prematureComplete.errCode, 'INVALID_TRANSITION',
    '尚有未保存的修改时不能完成场次');

  result = await h.command('host', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId }, payload: { text: '汇总期修改稿' }
  });
  assert.equal(result.ok, true);
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_SUMMARY');
  assert.equal(snapshot.view.route.name, 'creativeSummary');
  assert.equal(snapshot.view.session.publicModeState.ideas
    .find((item) => item.memberId === snapshot.view.actor.memberId).text, '汇总期修改稿');
});

test('已完成场次保持不可变，当前人数不足时拒绝重开', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  snapshot = await h.snapshot('host');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'A' } });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'B' } });
  await h.command('host', 'COMPLETE_HALLI_SESSION', { context: { sessionId } });
  await h.command('u2', 'LEAVE_ROOM');

  snapshot = await h.snapshot('host');
  const departed = snapshot.view.session.participants.find((item) => item.nickName === '玩家2');
  assert.equal(departed.status, 'ACTIVE');
  const replay = await h.command('host', 'REPLAY_WORKSHOP_SESSION', { context: { sessionId } });
  assert.equal(replay.errCode, 'NOT_ENOUGH_PLAYERS');
  assert.equal((await h.snapshot('host')).view.session.sessionId, sessionId);
});

test('Halli 待提交成员离开时会缩减门槛并自动进入汇总', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  snapshot = await h.snapshot('host');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'A' } });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'B' } });
  await h.command('u3', 'LEAVE_ROOM');
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_SUMMARY');
});

test('Halli 已提交成员离开后不会用旧提交数提前完成', async () => {
  const h = createHarness();
  await h.seedMembers(4);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  snapshot = await h.snapshot('host');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'A' } });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'B' } });
  await h.command('u2', 'LEAVE_ROOM');
  await h.command('u3', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'C' } });
  assert.equal((await h.snapshot('host')).view.session.workflow.step, 'HALLI_CREATIVE');
  await h.command('u4', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'D' } });
  assert.equal((await h.snapshot('host')).view.session.workflow.step, 'HALLI_SUMMARY');
});

test('Halli 线下活动期首位成员离开时原子替换为下一位有效参与者', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  const u2MemberId = (await h.snapshot('u2')).view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: u2MemberId }
  });
  await h.command('u2', 'LEAVE_ROOM');
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_ACTIVITY');
  assert.equal(snapshot.view.session.setup.proposedFirstMemberId, snapshot.view.actor.memberId);
  assert.equal(snapshot.view.session.workflow.activeMemberId, snapshot.view.actor.memberId);
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.activeMemberId, null);
});
