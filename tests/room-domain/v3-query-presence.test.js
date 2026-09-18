'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { projectPageSnapshot, memberSeat } = require('../../modules/room-session/page-model');
const {
  VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, MAX_INCREMENTAL_SYNC_EVENTS,
  MAX_SYNC_RESPONSE_BYTES, SIGNAL_TYPES, SIGNAL_TTL_MS, DESIGN_PROBLEM_NUDGE_COOLDOWN_MS,
  stableStringify
} = require('@cardboard/room-contracts');

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
  assert.equal(page.members.every((member) => !Object.prototype.hasOwnProperty.call(member, 'userId')), true);
  assert.equal(page.roomState.progress.turnId, 't1');
});

test('Partner 页面模型把收尾阶段枚举转换为页面使用的小写值', () => {
  const baseView = {
    room: {
      roomId: '12345678', lifecycle: 'OPEN', hostMemberId: 'm1', workshopName: '测试工作坊',
      createdAt: 1, members: [{ memberId: 'm1', seatNo: 1, nickName: '主持人' }]
    },
    session: {
      sessionId: 's1', mode: 'PARTNER', status: 'RUNNING',
      workflow: { step: 'PARTNER_CLOSING_RUNE' },
      setup: { scenario: null, selectedProblem: '问题' },
      participants: [{ memberId: 'm1', seatNoAtStart: 1, nickName: '主持人' }],
      publicModeState: {
        turnOrdinal: 1, roundNo: 1,
        closing: { stage: 'RUNE', sourceTurnId: 't1' }
      },
      activeTurn: null, activeArtifacts: [], recentMessages: [], turnSummaries: []
    },
    actor: {
      memberId: 'm1', role: 'HOST', seatNo: 1, isParticipant: true,
      scoreStatus: { submitted: false }, capabilities: {}
    },
    route: { name: 'partnerGame', params: {} }
  };

  const rune = projectPageSnapshot(baseView, { seq: 1, serverNow: 1, ephemeral: {} });
  assert.equal(rune.roomState.partnerClosingStep, 'rune');

  const reviewView = {
    ...baseView,
    session: {
      ...baseView.session,
      workflow: { step: 'PARTNER_CLOSING_REVIEW' },
      publicModeState: {
        ...baseView.session.publicModeState,
        closing: { stage: 'REVIEW', sourceTurnId: 't1' }
      }
    }
  };
  const review = projectPageSnapshot(reviewView, { seq: 2, serverNow: 2, ephemeral: {} });
  assert.equal(review.roomState.partnerClosingStep, 'review');
});

test('Partner 页面模型只消费当前行动范围内且未过期的瞬时信号', () => {
  const view = {
    room: {
      roomId: '12345678', lifecycle: 'OPEN', hostMemberId: 'm1', workshopName: '测试工作坊',
      createdAt: 1, members: [{ memberId: 'm1', seatNo: 1, nickName: '主持人' }]
    },
    session: {
      sessionId: 's1', mode: 'PARTNER', status: 'RUNNING', workflow: { step: 'PARTNER_TURN' },
      setup: { scenario: null, selectedProblem: null }, progress: {},
      participants: [{ memberId: 'm1', seatNoAtStart: 1, nickName: '主持人' }],
      publicModeState: { turnOrdinal: 1, roundNo: 1, closing: null },
      activeTurn: {
        turnId: 't1', ordinal: 1, roundNo: 1, activeMemberId: 'm1',
        turnStartedAt: 10000, phaseStartedAt: 10000, silentDeadlineAt: 30000,
        scoredCount: 0, requiredScoreCount: 0
      },
      activeArtifacts: [], recentMessages: [], turnSummaries: [], result: null
    },
    actor: {
      memberId: 'm1', role: 'HOST', seatNo: 1, isParticipant: true,
      contributionStatus: { submitted: false }, scoreStatus: { submitted: false },
      voteStatus: { submitted: false }, privateModeState: null, capabilities: {}
    },
    route: { name: 'partnerGame', params: {} }
  };
  const project = (signal, serverNow = 20000) => projectPageSnapshot(view, {
    seq: 1,
    serverNow,
    ephemeral: { signals: { PARTNER_SILENT_SOUND: signal } }
  }).roomState.partnerSilentSoundLevel;

  assert.equal(project({ value: 0.8, sessionId: 's1', turnId: 't1', expiresAt: 19999 }), 0);
  assert.equal(project({ value: 0.7, sessionId: 's1', turnId: 'old-turn', expiresAt: 25000 }), 0);
  assert.equal(project({ value: 0.6, sessionId: 's1', turnId: 't1', expiresAt: 25000 }), 0.6);
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

test('中途加入者留在大厅旁观，参玩者的游戏页只投影冻结 Participant', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  await h.command('u4', 'JOIN_ROOM', { payload: { nickName: '中途加入者' } });

  const hostSnapshot = await h.snapshot('host');
  const observerSnapshot = await h.snapshot('u4');
  const hostPage = projectPageSnapshot(hostSnapshot.view, {
    seq: hostSnapshot.seq, stateVersion: hostSnapshot.stateVersion, ephemeral: {}
  });
  const observerPage = projectPageSnapshot(observerSnapshot.view, {
    seq: observerSnapshot.seq, stateVersion: observerSnapshot.stateVersion, ephemeral: {}
  });

  assert.equal(hostPage.members.length, 3);
  assert.equal(hostPage.members.some((member) => member.nickName === '中途加入者'), false);
  assert.equal(observerPage.isParticipant, false);
  assert.equal(observerSnapshot.view.route.name, 'addPlayer');
  assert.equal(observerPage.members.length, 4, '旁观者在大厅仍应看到当前 Room Member');
  assert.equal(observerSnapshot.view.actor.capabilities.SUBMIT_PARTNER_SCORE.allowed, false);
});

test('Partner 匿名消息保持有界实时 View，并可通过游标完整分页读取', async () => {
  const h = createHarness();
  let snapshot = await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  const hostMemberId = (await h.snapshot('host')).view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: hostMemberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: hostMemberId }
  });
  snapshot = await h.snapshot('host');
  const turnId = snapshot.view.session.activeTurn.turnId;
  for (let index = 1; index <= 45; index += 1) {
    const posted = await h.command('u2', 'POST_PARTNER_MESSAGE', {
      context: { sessionId, turnId, workflowStep: 'PARTNER_TURN' },
      payload: { text: `消息${String(index).padStart(2, '0')}` }
    });
    assert.equal(posted.ok, true);
  }

  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.recentMessages.length, 40);
  assert.equal(snapshot.view.session.recentMessages[0].text, '消息06');

  const first = await h.app.readMessages('12345678', sessionId, { userId: 'host' }, { limit: 20 });
  const second = await h.app.readMessages('12345678', sessionId, { userId: 'host' }, {
    limit: 20, beforeSeq: first.nextBeforeSeq
  });
  const third = await h.app.readMessages('12345678', sessionId, { userId: 'host' }, {
    limit: 20, beforeSeq: second.nextBeforeSeq
  });
  const all = [...first.messages, ...second.messages, ...third.messages];
  assert.deepEqual([first.hasMore, second.hasMore, third.hasMore], [true, true, false]);
  assert.equal(all.length, 45);
  assert.equal(new Set(all.map((message) => message.messageId)).size, 45);
  assert.equal(JSON.stringify(all).includes('authorMemberId'), false);
  assert.equal((await h.app.readMessages('12345678', sessionId, { userId: 'stranger' }, {})).errCode,
    'NOT_MEMBER');
});

test('查询拒绝模糊标识，非法 Presence 上下文被安全忽略', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  assert.equal((await h.app.readSnapshot('../rooms', { userId: 'host' })).errCode, 'INVALID_ARGUMENT');
  assert.equal((await h.app.readSessionSnapshot('12345678', {}, { userId: 'host' })).errCode, 'INVALID_ARGUMENT');
  const result = await h.app.readSnapshot('12345678', { userId: 'host', touchPresence: true,
    deviceSessionId: { ambiguous: true } });
  assert.equal(result.ok, true);
  assert.equal(h.repo.presence.size, 0);
});

test('任意房间协议可续租 Presence，且不改变业务水位', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const before = await h.snapshot('host');
  const memberId = (await h.snapshot('u2')).view.actor.memberId;
  const beat = await h.app.sync('12345678', before.seq, {
    userId: 'u2', deviceSessionId: 'd1', touchPresence: true
  });
  assert.equal(beat.ok, true);
  const after = await h.snapshot('host');
  assert.equal(after.seq, before.seq);
  assert.equal(after.stateVersion, before.stateVersion);
  assert.equal(after.ephemeral.presenceByMemberId[memberId].online, true);

  await h.command('u2', 'LEAVE_ROOM');
  const afterLeave = await h.snapshot('host');
  assert.equal(afterLeave.ephemeral.presenceByMemberId[memberId], undefined);
});

test('Sync 返回连续投影事件且不泄漏内部事件；过期与越界水位要求 Snapshot', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const batch = await h.app.sync('12345678', 0, { userId: 'host' });
  assert.deepEqual(batch.events.map((item) => item.seq), [1, 2]);
  assert.equal(batch.throughSeq, 2);
  assert.equal(batch.events.every((item) => Array.isArray(item.publicEvents)), true);
  assert.equal(batch.events.some((item) => item.actorPatch), true);
  assert.equal(batch.events.some((item) => Object.prototype.hasOwnProperty.call(item, 'rawEvents')), false);
  assert.equal(batch.events.some((item) => Object.prototype.hasOwnProperty.call(item, 'actorProjections')), false);
  h.repo.events.set('12345678', h.repo.events.get('12345678').slice(1));
  assert.equal((await h.app.sync('12345678', 0, { userId: 'host' })).delivery, 'SNAPSHOT');
  assert.equal((await h.app.sync('12345678', 999, { userId: 'host' })).delivery, 'SNAPSHOT');
});

test('Sync 不得把旧 View Schema 的 Event 包装成当前版本', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const events = h.repo.events.get('12345678');

  assert.equal(events.every((event) => event.viewSchemaVersion === VIEW_SCHEMA_VERSION), true);
  events[0].viewSchemaVersion = VIEW_SCHEMA_VERSION - 1;

  const batch = await h.app.sync('12345678', 0, { userId: 'host' });
  assert.equal(batch.delivery, 'SNAPSHOT');
  assert.equal(batch.events, undefined);
});

test('Sync 积压超过 25 条时在同一响应内返回最新 Snapshot', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  for (let index = 0; index < MAX_INCREMENTAL_SYNC_EVENTS - 2; index += 1) {
    const updated = await h.command('host', 'UPDATE_ROOM_PROFILE', {
      payload: { workshopName: `工作坊-${index}` }
    });
    assert.equal(updated.ok, true);
  }

  const boundary = await h.app.sync('12345678', 0, { userId: 'host' });
  assert.equal(boundary.delivery, 'EVENTS');
  assert.equal(boundary.events.length, MAX_INCREMENTAL_SYNC_EVENTS);

  await h.command('host', 'UPDATE_ROOM_PROFILE', {
    payload: { workshopName: '工作坊-23' }
  });

  const batch = await h.app.sync('12345678', 0, { userId: 'host' });

  assert.equal(batch.delivery, 'SNAPSHOT');
  assert.equal(batch.events, undefined);
  assert.equal(batch.snapshot.ok, true);
  assert.equal(batch.snapshot.seq, MAX_INCREMENTAL_SYNC_EVENTS + 1);
  assert.equal(batch.snapshot.view.room.workshopName, '工作坊-23');
});

test('Sync 同时受事件数量与响应字节预算约束', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const aggregate = h.repo.rooms.get('12345678');
  const payload = '中'.repeat(90000);
  const events = Array.from({ length: 4 }, (_, index) => ({
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    viewSchemaVersion: VIEW_SCHEMA_VERSION,
    roomId: '12345678',
    seq: index + 1,
    stateVersion: index + 1,
    commandId: `large-${index + 1}`,
    sessionId: null,
    rawEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
    publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
    publicPatch: {
      set: [{ path: 'room.workshopName', value: `${index}-${payload}` }],
      remove: [],
      splice: []
    },
    actorProjections: [],
    occurredAt: index + 1
  }));
  aggregate.room.eventSeq = 4;
  aggregate.room.stateVersion = 4;
  h.repo.events.set('12345678', events);

  const batch = await h.app.sync('12345678', 0, { userId: 'host' }, { limit: 100 });

  assert.equal(batch.ok, true);
  assert.equal(batch.delivery, 'EVENTS');
  assert.equal(batch.events.length > 0 && batch.events.length < events.length, true);
  assert.equal(batch.hasMore, true);
  assert.equal(Buffer.byteLength(stableStringify(batch), 'utf8') <= MAX_SYNC_RESPONSE_BYTES, true);
});

test('单个事件超过 Sync 字节预算时要求 Snapshot，不能返回不推进的空批', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const aggregate = h.repo.rooms.get('12345678');
  aggregate.room.eventSeq = 1;
  aggregate.room.stateVersion = 1;
  h.repo.events.set('12345678', [{
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    viewSchemaVersion: VIEW_SCHEMA_VERSION,
    roomId: '12345678', seq: 1, stateVersion: 1, commandId: 'oversized', sessionId: null,
    rawEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
    publicEvents: [{ type: 'ROOM_PROFILE_UPDATED' }],
    publicPatch: {
      set: [{ path: 'room.workshopName', value: '大'.repeat(MAX_SYNC_RESPONSE_BYTES) }],
      remove: [], splice: []
    },
    actorProjections: [], occurredAt: 1
  }]);

  const batch = await h.app.sync('12345678', 0, { userId: 'host' });

  assert.equal(batch.delivery, 'SNAPSHOT');
  assert.equal(batch.events, undefined);
});

test('Event TTL 清空日志后不会产生空批死循环，而是要求 Snapshot', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  h.repo.events.set('12345678', []);

  const batch = await h.app.sync('12345678', 0, { userId: 'host' });
  const snapshot = await h.snapshot('host');
  assert.equal(batch.delivery, 'SNAPSHOT');
  assert.equal(snapshot.minAvailableSeq, snapshot.seq + 1);
});

test('轻量 Sync 不得投影当前 Session 中其他 Turn 的旧信号', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  const snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  h.repo.signals.set('stale-signal', {
    roomId: '12345678', signalType: 'PARTNER_SILENT_SOUND', value: 0.9,
    memberId: snapshot.view.actor.memberId, sessionId, turnId: 'old-turn',
    updatedAt: 1000, expiresAt: 999999
  });

  const batch = await h.app.sync('12345678', snapshot.seq, { userId: 'host' });

  assert.equal(batch.ok, true);
  assert.equal(batch.ephemeral.signals.PARTNER_SILENT_SOUND, undefined);
});

test('瞬时声贝写入与当前静默行动使用同一事务范围令牌', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
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
  await h.command('host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: snapshot.view.actor.memberId }
  });
  snapshot = await h.snapshot('host');
  const turnId = snapshot.view.session.activeTurn.turnId;
  await h.command('host', 'USE_PARTNER_SPECIAL', {
    context: { sessionId, turnId }, payload: { kind: 'SILENT' }
  });

  const written = await h.app.writeSignal({
    roomId: '12345678', sessionId, turnId, signalType: 'PARTNER_SILENT_SOUND', value: 1.5
  }, { userId: 'host' });
  const wrongActor = await h.app.writeSignal({
    roomId: '12345678', sessionId, turnId, signalType: 'PARTNER_SILENT_SOUND', value: 0.5
  }, { userId: 'u2' });
  await h.command('host', 'CANCEL_WORKSHOP_SESSION', { context: { sessionId } });
  const stale = await h.app.writeSignal({
    roomId: '12345678', sessionId, turnId, signalType: 'PARTNER_SILENT_SOUND', value: 0.5
  }, { userId: 'host' });

  assert.equal(written.ok, true);
  assert.equal(written.signal.value, 1, '声贝值应由服务端收敛到 0～1');
  assert.equal(wrongActor.errCode, 'INVALID_TRANSITION');
  assert.equal(stale.errCode, 'INVALID_TRANSITION');
  assert.equal(h.repo.rooms.get('12345678').room.signalScope, null);
});

test('静默声贝仅房主可写，即使当前行动者不是房主', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  const hostMemberId = (await h.snapshot('host')).view.actor.memberId;
  const playerMemberId = (await h.snapshot('u2')).view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { memberId: playerMemberId }
  });
  await h.command('host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: playerMemberId }
  });
  snapshot = await h.snapshot('u2');
  const turnId = snapshot.view.session.activeTurn.turnId;
  await h.command('u2', 'USE_PARTNER_SPECIAL', {
    context: { sessionId, turnId }, payload: { kind: 'SILENT' }
  });

  assert.equal(h.repo.rooms.get('12345678').room.signalScope.memberId, hostMemberId);

  const actorWrite = await h.app.writeSignal({
    roomId: '12345678', sessionId, turnId, signalType: 'PARTNER_SILENT_SOUND', value: 0.4
  }, { userId: 'u2' });
  const hostWrite = await h.app.writeSignal({
    roomId: '12345678', sessionId, turnId, signalType: 'PARTNER_SILENT_SOUND', value: 0.7
  }, { userId: 'host' });
  const otherWrite = await h.app.writeSignal({
    roomId: '12345678', sessionId, turnId, signalType: 'PARTNER_SILENT_SOUND', value: 0.2
  }, { userId: 'u3' });

  assert.equal(actorWrite.errCode, 'INVALID_TRANSITION');
  assert.equal(otherWrite.errCode, 'INVALID_TRANSITION');
  assert.equal(hostWrite.ok, true);
  assert.equal(hostWrite.signal.value, 0.7);
  assert.equal(hostWrite.signal.memberId, hostMemberId);

  const heard = await h.app.sync('12345678', 0, { userId: 'u3' });
  assert.equal(heard.ephemeral.signals.PARTNER_SILENT_SOUND.value, 0.7);
});

async function startCollectingDesignProblems(h, memberCount) {
  await h.seedMembers(memberCount);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  const started = await h.snapshot('host');
  const sessionId = started.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: {
      source: 'CUSTOM',
      scenario: { scene: '课堂', user: '学生', platform: '小程序', function: '协作' }
    }
  });
  return sessionId;
}

test('已提交者可广播催促未提交者，且不推进业务水位', async () => {
  const h = createHarness();
  const sessionId = await startCollectingDesignProblems(h, 3);
  await h.command('host', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何让协作更顺畅？' }
  });
  const before = await h.snapshot('host');

  const denied = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE
  }, { userId: 'u2' });
  const written = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE
  }, { userId: 'host' });
  const after = await h.snapshot('u2');
  const batch = await h.app.sync('12345678', before.seq, { userId: 'u2' });

  assert.equal(denied.ok, false);
  assert.equal(denied.errCode, 'INVALID_TRANSITION');
  assert.equal(written.ok, true);
  assert.equal(written.signal.signalType, SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE);
  assert.equal(written.signal.value, 1);
  assert.equal(after.seq, before.seq);
  assert.equal(after.stateVersion, before.stateVersion);
  assert.equal(after.ephemeral.signals.DESIGN_PROBLEM_NUDGE.sessionId, sessionId);
  assert.equal(batch.ok, true);
  assert.equal(batch.delivery, 'EVENTS');
  assert.equal(batch.ephemeral.signals.DESIGN_PROBLEM_NUDGE.updatedAt, written.signal.updatedAt);
});

test('同一成员催促冷却期内幂等，其他已提交者仍可覆盖催促', async () => {
  const h = createHarness();
  const sessionId = await startCollectingDesignProblems(h, 3);
  await h.command('host', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何让协作更顺畅？' }
  });
  await h.command('u2', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何降低沟通成本？' }
  });

  const first = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE
  }, { userId: 'host' });
  const replay = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE
  }, { userId: 'host' });
  const other = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE
  }, { userId: 'u2' });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.signal.updatedAt, first.signal.updatedAt);
  assert.equal(other.ok, true);
  assert.equal(other.signal.updatedAt > first.signal.updatedAt, true);
  assert.equal(other.signal.memberId !== first.signal.memberId, true);
});

test('催促信号过期后不再投影，离开收集问题步骤后不能再写', async () => {
  const h = createHarness();
  const sessionId = await startCollectingDesignProblems(h, 3);
  await h.command('host', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何让协作更顺畅？' }
  });
  const written = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE
  }, { userId: 'host' });
  assert.equal(written.ok, true);

  h.advanceTime(SIGNAL_TTL_MS[SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE] + 1);
  const expired = await h.snapshot('u2');
  assert.equal(expired.ephemeral.signals.DESIGN_PROBLEM_NUDGE, undefined);

  await h.command('u2', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何降低沟通成本？' }
  });
  await h.command('u3', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '如何快速达成共识？' }
  });
  const stale = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE
  }, { userId: 'host' });
  assert.equal(stale.ok, false);
  assert.equal(stale.errCode, 'INVALID_TRANSITION');
  assert.equal(DESIGN_PROBLEM_NUDGE_COOLDOWN_MS, 15000);
});

async function startSelectingDesignProblems(h, memberCount) {
  const sessionId = await startCollectingDesignProblems(h, memberCount);
  const users = ['host', 'u2', 'u3'].slice(0, memberCount);
  const texts = ['如何让协作更顺畅？', '如何降低沟通成本？', '如何快速达成共识？'];
  for (let i = 0; i < users.length; i += 1) {
    await h.command(users[i], 'SUBMIT_DESIGN_PROBLEM', {
      context: { sessionId }, payload: { text: texts[i] }
    });
  }
  return sessionId;
}

test('房主可广播设计问题编辑态，非房主能看到且不推进业务水位', async () => {
  const h = createHarness();
  const sessionId = await startSelectingDesignProblems(h, 3);
  const host = await h.snapshot('host');
  const problemId = host.view.session.setup.designProblems[0].contributionId;
  const before = await h.snapshot('u2');

  const denied = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: problemId
  }, { userId: 'u2' });
  const written = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: problemId
  }, { userId: 'host' });
  const after = await h.snapshot('u2');
  const page = projectPageSnapshot(after.view, {
    roomId: after.roomId, seq: after.seq, stateVersion: after.stateVersion,
    serverNow: after.serverTime, ephemeral: after.ephemeral
  });

  assert.equal(denied.ok, false);
  assert.equal(denied.errCode, 'HOST_REQUIRED');
  assert.equal(written.ok, true);
  assert.equal(written.signal.signalType, SIGNAL_TYPES.DESIGN_PROBLEM_EDITING);
  assert.equal(written.signal.value, problemId);
  assert.equal(after.seq, before.seq);
  assert.equal(after.stateVersion, before.stateVersion);
  assert.equal(after.ephemeral.signals.DESIGN_PROBLEM_EDITING.value, problemId);
  assert.equal(after.view.route.name, 'selectProblem');
  assert.equal(page.roomState.editingProblemId, problemId);
  assert.equal(page.roomState.currentPage, 'selectProblem');

  const idle = await h.app.sync('12345678', after.seq, { userId: 'u2' });
  assert.equal(idle.ok, true);
  assert.equal(idle.delivery, 'EVENTS');
  assert.equal(idle.events.length, 0);
  assert.equal(idle.ephemeral.signals.DESIGN_PROBLEM_EDITING.value, problemId);
});

test('结束编辑或过期后不再投影编辑态，离开选题步骤后不能再写', async () => {
  const h = createHarness();
  const sessionId = await startSelectingDesignProblems(h, 3);
  const host = await h.snapshot('host');
  const problemId = host.view.session.setup.designProblems[0].contributionId;
  const written = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: problemId
  }, { userId: 'host' });
  assert.equal(written.ok, true);

  const cleared = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: ''
  }, { userId: 'host' });
  const afterClear = await h.snapshot('u2');
  assert.equal(cleared.ok, true);
  assert.equal(afterClear.ephemeral.signals.DESIGN_PROBLEM_EDITING, undefined);

  const rewritten = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: problemId
  }, { userId: 'host' });
  assert.equal(rewritten.ok, true);
  h.advanceTime(SIGNAL_TTL_MS[SIGNAL_TYPES.DESIGN_PROBLEM_EDITING] + 1);
  const expired = await h.snapshot('u2');
  assert.equal(expired.ephemeral.signals.DESIGN_PROBLEM_EDITING, undefined);

  await h.command('host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' },
    payload: { contributionId: problemId }
  });
  const stale = await h.app.writeSignal({
    roomId: '12345678', sessionId, signalType: SIGNAL_TYPES.DESIGN_PROBLEM_EDITING, value: problemId
  }, { userId: 'host' });
  assert.equal(stale.ok, false);
  assert.equal(stale.errCode, 'INVALID_TRANSITION');
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
  const departedView = await h.app.readSessionSnapshot('12345678', sessionId, {
    userId: 'u2', deviceSessionId: 'departed-device', touchPresence: true
  });
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
  assert.equal([...h.repo.presence.values()].some((item) =>
    item.memberId === departedView.view.actor.memberId), false, '历史回看不能把已离房参与者标记在线');
  assert.equal(JSON.stringify(departedView.view).includes('"userId"'), false);
  assert.deepEqual(archived.view.session.publicModeState.ideas.map((item) => item.text), ['A', 'B']);
  assert.equal(archived.view.room.members.length, 1);
  assert.equal(pageSnapshot.members.length, 2, '历史页必须使用场次内冻结的参与者还原');
  assert.doesNotThrow(() => JSON.stringify(pageSnapshot), '页面快照必须可序列化，不能包含 raw 循环引用');
});
