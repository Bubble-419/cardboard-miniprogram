'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { projectPageSnapshot, memberSeat } = require('../../modules/room-session/page-model');

test('场次内座位映射优先使用冻结 Participant，而不是后来调整的 Room Seat', () => {
  const view = {
    room: { members: [{ memberId: 'm1', seatNo: 2 }] },
    session: { participants: [{ memberId: 'm1', seatNoAtStart: 1 }] }
  };
  assert.equal(memberSeat(view, 'm1'), 1);
});

test('Partner 页面模型把计时锚点换算到本机时钟域', () => {
  const view = {
    room: {
      roomId: '12345678', lifecycle: 'OPEN', hostMemberId: 'm1', workshopName: '测试工作坊',
      createdAt: 1, members: [{ memberId: 'm1', seatNo: 1, nickName: '主持人' }]
    },
    session: {
      sessionId: 's1', mode: 'PARTNER', status: 'RUNNING', workflow: { step: 'PARTNER_PLAY' },
      setup: { scenario: 'OFFLINE', selectedProblem: '问题' },
      participants: [{ memberId: 'm1', seatNoAtStart: 1, nickName: '主持人' }],
      publicModeState: { turnOrdinal: 1, roundNo: 1, closing: null },
      activeTurn: {
        turnId: 't1', ordinal: 1, roundNo: 1, activeMemberId: 'm1',
        turnStartedAt: 10000, phaseStartedAt: 11000, silentStartedAt: 12000,
        silentDeadlineAt: 20000, scoredCount: 0, requiredScoreCount: 0
      },
      activeArtifacts: [], recentMessages: [], turnSummaries: []
    },
    actor: {
      memberId: 'm1', role: 'HOST', seatNo: 1,
      scoreStatus: { submitted: false }, capabilities: {}
    },
    route: { name: 'partnerGame', params: {} }
  };
  const page = projectPageSnapshot(view, {
    seq: 1, serverNow: 15000, serverClockOffsetMs: 5000, ephemeral: {}
  });
  assert.equal(page.roomState.partnerTurnStartedAt, 5000);
  assert.equal(page.roomState.partnerRoundStartedAt, 6000);
  assert.equal(page.roomState.partnerSilentStartedAt, 7000);
});

test('Snapshot 是可独立恢复的成员视图且不暴露 userId', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = h.repo.rooms.get('12345678').room.stateVersion;
  const snapshot = await h.snapshot('u2');
  assert.equal(snapshot.seq, 2);
  assert.equal(snapshot.stateVersion, 2);
  assert.equal(snapshot.view.actor.role, 'PLAYER');
  assert.equal(JSON.stringify(snapshot.view).includes('"userId"'), false);
  assert.equal(h.repo.rooms.get('12345678').room.stateVersion, before);
  assert.equal((await h.snapshot('stranger')).errCode, 'NOT_MEMBER');
});

test('查询与 Presence 拒绝模糊标识，不把任意对象或路径交给仓储层', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  assert.equal((await h.app.readSnapshot('../rooms', { userId: 'host' })).errCode, 'INVALID_ARGUMENT');
  assert.equal((await h.app.readSessionSnapshot('12345678', {}, { userId: 'host' })).errCode, 'INVALID_ARGUMENT');
  assert.equal((await h.app.heartbeat('12345678', { userId: 'host' }, {
    deviceSessionId: { ambiguous: true }
  })).errCode, 'INVALID_ARGUMENT');
});

test('Presence 不改变业务水位，只进入 ephemeral', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = await h.snapshot('host');
  const beat = await h.app.heartbeat('12345678', { userId: 'u2' }, { deviceSessionId: 'd1' });
  assert.equal(beat.ok, true);
  const after = await h.snapshot('host');
  assert.equal(after.seq, before.seq);
  assert.equal(after.stateVersion, before.stateVersion);
  assert.equal(after.ephemeral.presenceByMemberId[beat.presence.memberId].online, true);

  await h.command('u2', 'LEAVE_ROOM');
  const afterLeave = await h.snapshot('host');
  assert.equal(afterLeave.ephemeral.presenceByMemberId[beat.presence.memberId], undefined);
});

test('Sync 返回连续完整事件组；过期与越界水位要求 Snapshot', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const batch = await h.app.sync('12345678', 0, { userId: 'host' });
  assert.deepEqual(batch.events.map((item) => item.seq), [1, 2]);
  assert.equal(batch.throughSeq, 2);
  assert.ok(batch.actorView.actor);
  h.repo.events.set('12345678', h.repo.events.get('12345678').slice(1));
  assert.equal((await h.app.sync('12345678', 0, { userId: 'host' })).snapshotRequired, true);
  assert.equal((await h.app.sync('12345678', 999, { userId: 'host' })).snapshotRequired, true);
});

test('Event TTL 清空日志后不会产生空批死循环，而是要求 Snapshot', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  h.repo.events.set('12345678', []);

  const batch = await h.app.sync('12345678', 0, { userId: 'host' });
  const snapshot = await h.snapshot('host');
  assert.equal(batch.snapshotRequired, true);
  assert.equal(snapshot.minAvailableSeq, snapshot.seq + 1);
});

test('完成场次可从历史分页发现，并在返回大厅后由 View 完整还原', async () => {
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

  const replay = await h.command('host', 'REPLAY_WORKSHOP_SESSION', { context: { sessionId } });
  const replaySessionId = replay.outcome.sessionId;
  snapshot = await h.snapshot('host');
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId: replaySessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: snapshot.view.actor.memberId }
  });
  await h.command('host', 'END_HALLI_ACTIVITY', { context: { sessionId: replaySessionId } });
  await h.command('host', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId: replaySessionId }, payload: { text: 'C' }
  });
  await h.command('u2', 'SUBMIT_HALLI_IDEA', {
    context: { sessionId: replaySessionId }, payload: { text: 'D' }
  });
  await h.command('host', 'COMPLETE_HALLI_SESSION', { context: { sessionId: replaySessionId } });

  const firstPage = await h.app.readHistory('12345678', { userId: 'host' }, { limit: 1 });
  assert.equal(firstPage.ok, true);
  assert.equal(firstPage.hasMore, true);
  assert.deepEqual(firstPage.sessions.map((item) => item.sessionId), [replaySessionId]);
  const secondPage = await h.app.readHistory('12345678', { userId: 'host' }, {
    limit: 1, beforeOrdinal: firstPage.nextBeforeOrdinal
  });
  assert.equal(secondPage.hasMore, false);
  assert.deepEqual(secondPage.sessions.map((item) => item.sessionId), [sessionId]);

  await h.command('host', 'RETURN_TO_LOBBY', { context: { sessionId: replaySessionId } });
  assert.equal((await h.snapshot('host')).view.session, null);
  await h.command('u2', 'LEAVE_ROOM');
  const archived = await h.app.readSessionSnapshot('12345678', sessionId, { userId: 'host' });
  const departedView = await h.app.readSessionSnapshot('12345678', sessionId, { userId: 'u2' });
  const current = await h.snapshot('host');
  const pageSnapshot = projectPageSnapshot(archived.view, {
    seq: archived.seq,
    ephemeral: {},
    serverNow: archived.serverTime
  });
  assert.equal(archived.ok, true);
  assert.equal(archived.seq, current.seq);
  assert.equal(Number.isInteger(archived.stateVersion), true);
  assert.equal(archived.view.session.status, 'COMPLETED');
  assert.equal(departedView.ok, true);
  assert.equal(departedView.view.actor.memberId,
    departedView.view.session.participants.find((item) => item.nickName === '玩家2').memberId);
  assert.equal(JSON.stringify(departedView.view).includes('"userId"'), false);
  assert.deepEqual(archived.view.session.publicModeState.ideas.map((item) => item.text), ['A', 'B']);
  assert.equal(archived.view.room.members.length, 1);
  assert.equal(pageSnapshot.members.length, 2, '历史页必须使用场次内冻结的参与者还原');
  assert.doesNotThrow(() => JSON.stringify(pageSnapshot), '页面快照必须可序列化，不能包含 raw 循环引用');
});
