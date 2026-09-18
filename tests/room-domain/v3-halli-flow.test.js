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
  assert.equal(snapshot.view.session.publicModeState.ideas.length, 0);
  await h.command('u3', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: '创意三' } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_SUMMARY');
  assert.equal(snapshot.view.session.publicModeState.ideas.length, 3);
  await h.command('host', 'COMPLETE_HALLI_SESSION', { context: { sessionId } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.status, 'COMPLETED');
  assert.equal(snapshot.view.session.result.ideaCount, 3);
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
