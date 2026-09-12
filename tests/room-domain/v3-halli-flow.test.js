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
  await h.command('host', 'SET_SCENARIO', { context: { sessionId }, payload: {
    source: 'CUSTOM', scene: '社区活动', user: '居民', function: '快速认识彼此'
  } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_FIRST_PLAYER');
  await h.command('host', 'SELECT_FIRST_PLAYER', { context: { sessionId }, payload: { memberId: snapshot.view.actor.memberId } });
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

test('Halli 待提交成员离开时会缩减门槛并自动进入汇总', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'HALLI_GALLI' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', { context: { sessionId }, payload: { source: 'OFFLINE' } });
  snapshot = await h.snapshot('host');
  await h.command('host', 'SELECT_FIRST_PLAYER', { context: { sessionId }, payload: { memberId: snapshot.view.actor.memberId } });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'A' } });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', { context: { sessionId }, payload: { text: 'B' } });
  await h.command('u3', 'LEAVE_ROOM');
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'HALLI_SUMMARY');
});
