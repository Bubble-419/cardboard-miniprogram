'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { reduceCommand } = require('@cardboard/room-domain');

async function seedSpy(playerCount = 3) {
  const h = createHarness({ wordPairPicker: () => ({ id: 'fixed', civilianWord: '苹果', civilianBlurb: '水果', spyWord: '梨', spyBlurb: '另一种水果' }) });
  await h.seedMembers(playerCount);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'SPY' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  const started = await h.command('host', 'START_SPY_GAME', { context: { sessionId } });
  assert.equal(started.ok, true);
  snapshot = await h.snapshot('host');
  return { h, sessionId, gameId: snapshot.view.session.publicModeState.gameId };
}

function userForMember(snapshot, memberId) {
  const member = snapshot.view.room.members.find((item) => item.memberId === memberId);
  if (member.nickName === '房主') return 'host';
  return `u${member.seatNo}`;
}

async function finishSpeaking(h, sessionId, gameId) {
  while (true) {
    const snapshot = await h.snapshot('host');
    if (snapshot.view.session.workflow.step === 'SPY_VOTE') return snapshot;
    const publicSpy = snapshot.view.session.publicModeState;
    const userId = userForMember(snapshot, publicSpy.currentSpeakerMemberId);
    const result = await h.command(userId, 'ADVANCE_SPY_SPEAKER', {
      context: { sessionId, gameId, speakerTurnId: publicSpy.speakerTurnId }
    });
    assert.equal(result.ok, true);
  }
}

test('Spy 分牌仅进入本人 Actor View，公开状态和结算前事件不泄密', async () => {
  const { h, sessionId, gameId } = await seedSpy();
  const cards = [];
  for (const userId of ['host', 'u2', 'u3']) {
    const snapshot = await h.snapshot(userId);
    cards.push(snapshot.view.actor.privateModeState);
    const publicOnly = { room: snapshot.view.room, session: snapshot.view.session };
    assert.equal(JSON.stringify(publicOnly).includes('苹果'), false);
    assert.equal(JSON.stringify(publicOnly).includes('"梨"'), false);
  }
  assert.equal(cards.filter((item) => item.role === 'spy').length, 1);
  assert.equal(cards.filter((item) => item.role === 'civilian').length, 2);
  assert.equal(new Set(cards.map((item) => item.gameId)).size, 1);
  const preSettleEvents = (await h.app.sync('12345678', 0, { userId: 'host' })).events;
  const publicProjection = preSettleEvents.map((item) => ({
    publicEvents: item.publicEvents,
    publicPatch: item.publicPatch
  }));
  assert.equal(JSON.stringify(publicProjection).includes('苹果'), false);
  assert.equal(JSON.stringify(publicProjection).includes('"梨"'), false);
  assert.equal(preSettleEvents.some((item) => Object.prototype.hasOwnProperty.call(item, 'rawEvents')), false);
  assert.equal(preSettleEvents.some((item) => Object.prototype.hasOwnProperty.call(item, 'actorProjections')), false);
  assert.equal(gameId.length > 0 && sessionId.length > 0, true);
});

test('Spy 发言、投票、淘汰与两侧胜负自动推进', async () => {
  const { h, sessionId, gameId } = await seedSpy();
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const voteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  const actorCards = {};
  for (const userId of ['host', 'u2', 'u3']) actorCards[userId] = (await h.snapshot(userId)).view.actor.privateModeState;
  const spyUser = Object.keys(actorCards).find((userId) => actorCards[userId].role === 'spy');
  const spyMemberId = (await h.snapshot(spyUser)).view.actor.memberId;
  for (const userId of ['host', 'u2', 'u3']) {
    const payload = userId === spyUser ? { abstain: true } : { targetMemberId: spyMemberId };
    await h.command(userId, 'SUBMIT_SPY_VOTE', { context: { sessionId, gameId, voteSessionId }, payload });
  }
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_SETTLED');
  assert.equal(snapshot.view.session.publicModeState.winnerSide, 'civilian');
  assert.equal(snapshot.view.session.publicModeState.reveal.length, 3);
  assert.equal(snapshot.view.session.publicModeState.reveal.some((item) => item.role === 'spy'), true);

  await h.command('host', 'RESTART_SPY_GAME', { context: { sessionId, gameId } });
  snapshot = await h.snapshot('host');
  assert.notEqual(snapshot.view.session.publicModeState.gameId, gameId);
  assert.equal(snapshot.view.session.workflow.step, 'SPY_SPEAK');
  const stored = h.repo.rooms.get('12345678').facts;
  assert.equal(Object.values(stored.secrets).some((item) => item.gameId === gameId), false);
});

test('Spy 全员弃票产生无淘汰轮结果，并可开始下一轮', async () => {
  const { h, sessionId, gameId } = await seedSpy();
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const voteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  for (const userId of ['host', 'u2', 'u3']) {
    await h.command(userId, 'SUBMIT_SPY_VOTE', { context: { sessionId, gameId, voteSessionId }, payload: { abstain: true } });
  }
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_RESULT');
  assert.equal(snapshot.view.session.publicModeState.lastResult.eliminatedMemberId, null);
  await h.command('u2', 'START_NEXT_SPY_ROUND', {
    context: { sessionId, gameId, roundNo: snapshot.view.session.publicModeState.roundNo }
  });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.publicModeState.roundNo, 2);
  assert.equal(snapshot.view.session.workflow.step, 'SPY_SPEAK');
});

test('Spy 无人淘汰时下一轮使用新的随机发言顺序', async () => {
  const { h, sessionId, gameId } = await seedSpy(4);
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const voteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  for (const userId of ['host', 'u2', 'u3', 'u4']) {
    await h.command(userId, 'SUBMIT_SPY_VOTE', {
      context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
    });
  }
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_RESULT');
  const members = snapshot.view.room.members;
  const expectedOrder = [members[1].memberId, members[2].memberId, members[3].memberId, members[0].memberId];
  const domain = reduceCommand({
    aggregate: h.repo.rooms.get('12345678'),
    actorUserId: 'u2',
    command: {
      type: 'START_NEXT_SPY_ROUND',
      context: { sessionId, gameId, roundNo: 1 },
      payload: {}
    },
    deps: {
      now: 5000,
      idFactory: (prefix) => `${prefix}-next-round`,
      // Fisher-Yates 在四人队列上连续取 0，预期顺序是 2、3、4、1号位。
      random: () => 0
    }
  });
  assert.equal(domain.ok, true);
  assert.deepEqual(domain.aggregate.currentSession.modeState.spy.speakOrder, expectedOrder);
});

test('Spy 有人淘汰时保留上轮随机顺序并从淘汰者之后继续', async () => {
  const { h, sessionId, gameId } = await seedSpy(4);
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const previousOrder = snapshot.view.session.publicModeState.speakOrder.slice();
  const voteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  const users = ['host', 'u2', 'u3', 'u4'];
  const cards = {};
  for (const userId of users) cards[userId] = (await h.snapshot(userId)).view.actor.privateModeState;
  const targetUser = users.find((userId) => cards[userId].role === 'civilian');
  const targetMemberId = (await h.snapshot(targetUser)).view.actor.memberId;
  for (const userId of users) {
    await h.command(userId, 'SUBMIT_SPY_VOTE', {
      context: { sessionId, gameId, voteSessionId },
      payload: userId === targetUser ? { abstain: true } : { targetMemberId }
    });
  }

  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_RESULT');
  const eliminatedIndex = previousOrder.indexOf(targetMemberId);
  const expectedOrder = [];
  for (let offset = 1; offset <= previousOrder.length; offset += 1) {
    const memberId = previousOrder[(eliminatedIndex + offset) % previousOrder.length];
    if (memberId !== targetMemberId) expectedOrder.push(memberId);
  }
  await h.command('u2', 'START_NEXT_SPY_ROUND', {
    context: { sessionId, gameId, roundNo: snapshot.view.session.publicModeState.roundNo }
  });
  snapshot = await h.snapshot('host');
  assert.deepEqual(snapshot.view.session.publicModeState.speakOrder, expectedOrder);
});

test('Spy 平票加时只能投首轮并列成员', async () => {
  const { h, sessionId, gameId } = await seedSpy();
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const firstVoteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  const hostMemberId = snapshot.view.actor.memberId;
  const u2MemberId = (await h.snapshot('u2')).view.actor.memberId;

  await h.command('host', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId: firstVoteSessionId }, payload: { targetMemberId: u2MemberId }
  });
  await h.command('u2', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId: firstVoteSessionId }, payload: { targetMemberId: hostMemberId }
  });
  await h.command('u3', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId: firstVoteSessionId }, payload: { abstain: true }
  });

  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_TIE_SPEAK');
  assert.deepEqual(new Set(snapshot.view.session.publicModeState.lastResult.tiedMemberIds), new Set([hostMemberId, u2MemberId]));

  snapshot = await finishSpeaking(h, sessionId, gameId);
  const tieVoteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  const u3MemberId = (await h.snapshot('u3')).view.actor.memberId;
  const invalid = await h.command('host', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId: tieVoteSessionId }, payload: { targetMemberId: u3MemberId }
  });

  assert.equal(invalid.ok, false);
  assert.equal(invalid.errCode, 'INVALID_ARGUMENT');
  assert.equal((await h.snapshot('host')).view.actor.voteStatus.submitted, false);
});

test('Spy 房主强制开票必须绑定当前发言令牌', async () => {
  const { h, sessionId, gameId } = await seedSpy();
  let snapshot = await h.snapshot('host');
  const oldSpeakerTurnId = snapshot.view.session.publicModeState.speakerTurnId;
  const speakerUserId = userForMember(snapshot, snapshot.view.session.publicModeState.currentSpeakerMemberId);
  await h.command(speakerUserId, 'ADVANCE_SPY_SPEAKER', {
    context: { sessionId, gameId, speakerTurnId: oldSpeakerTurnId }
  });
  snapshot = await h.snapshot('host');
  const stale = await h.command('host', 'OPEN_SPY_VOTE', {
    context: { sessionId, gameId, speakerTurnId: oldSpeakerTurnId }
  });
  assert.equal(stale.errCode, 'STALE_CONTEXT');
  assert.equal((await h.command('host', 'OPEN_SPY_VOTE', {
    context: { sessionId, gameId, speakerTurnId: snapshot.view.session.publicModeState.speakerTurnId }
  })).ok, true);
});

test('Spy 中途淘汰只公开淘汰者身份，不公开任何词语或其他身份', async () => {
  const { h, sessionId, gameId } = await seedSpy(4);
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const voteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  const cards = {};
  for (const userId of ['host', 'u2', 'u3', 'u4']) {
    cards[userId] = (await h.snapshot(userId)).view.actor.privateModeState;
  }
  const targetUser = Object.keys(cards).find((userId) => cards[userId].role === 'civilian');
  const targetMemberId = (await h.snapshot(targetUser)).view.actor.memberId;
  for (const userId of ['host', 'u2', 'u3', 'u4']) {
    const payload = userId === targetUser ? { abstain: true } : { targetMemberId };
    await h.command(userId, 'SUBMIT_SPY_VOTE', { context: { sessionId, gameId, voteSessionId }, payload });
  }

  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_RESULT');
  assert.equal(snapshot.view.session.publicModeState.lastResult.eliminatedRole, 'civilian');
  assert.equal(snapshot.view.session.publicModeState.reveal.length, 0);
  const publicJson = JSON.stringify(snapshot.view.session);
  assert.equal(publicJson.includes('苹果'), false);
  assert.equal(publicJson.includes('"梨"'), false);
});

test('Spy 超时后的目标票由服务端强制记为弃票', async () => {
  const { h, sessionId, gameId } = await seedSpy();
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const state = snapshot.view.session.publicModeState;
  const voteSessionId = state.voteSessionId;
  const targetMemberId = state.players.find((item) => item.memberId !== snapshot.view.actor.memberId).memberId;
  h.advanceTime(2 * 60 * 1000 + 1);
  const result = await h.command('host', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { targetMemberId }
  });
  assert.equal(result.ok, true);
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.actor.voteStatus.vote, 'abstain');
  assert.equal(snapshot.view.actor.voteStatus.targetMemberId, null);
});

test('Spy 已投票成员离开后从当轮进度移除，其他成员仍需完成投票', async () => {
  const { h, sessionId, gameId } = await seedSpy(4);
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const voteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  const cards = {};
  for (const userId of ['host', 'u2', 'u3', 'u4']) {
    cards[userId] = (await h.snapshot(userId)).view.actor.privateModeState;
  }
  const leavingUser = ['u2', 'u3', 'u4'].find((userId) => cards[userId].role === 'civilian');
  const remainingUsers = ['u2', 'u3', 'u4'].filter((userId) => userId !== leavingUser);

  await h.command('host', 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
  });
  await h.command(leavingUser, 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
  });
  await h.command(leavingUser, 'LEAVE_ROOM');
  await h.command(remainingUsers[0], 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
  });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_VOTE');
  await h.command(remainingUsers[1], 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
  });
  assert.equal((await h.snapshot('host')).view.session.workflow.step, 'SPY_RESULT');
});

test('Spy 离房成员已经提交的票不再参与当轮淘汰', async () => {
  const { h, sessionId, gameId } = await seedSpy(5);
  let snapshot = await finishSpeaking(h, sessionId, gameId);
  const voteSessionId = snapshot.view.session.publicModeState.voteSessionId;
  const cards = {};
  for (const userId of ['host', 'u2', 'u3', 'u4', 'u5']) {
    cards[userId] = (await h.snapshot(userId)).view.actor.privateModeState;
  }
  const leavingUser = ['u2', 'u3', 'u4', 'u5'].find((userId) => cards[userId].role === 'civilian');
  const targetUser = ['host', 'u2', 'u3', 'u4', 'u5']
    .find((userId) => userId !== leavingUser && cards[userId].role === 'civilian');
  const targetMemberId = (await h.snapshot(targetUser)).view.actor.memberId;

  await h.command(leavingUser, 'SUBMIT_SPY_VOTE', {
    context: { sessionId, gameId, voteSessionId }, payload: { targetMemberId }
  });
  await h.command(leavingUser, 'LEAVE_ROOM');
  for (const userId of ['host', 'u2', 'u3', 'u4', 'u5'].filter((id) => id !== leavingUser)) {
    await h.command(userId, 'SUBMIT_SPY_VOTE', {
      context: { sessionId, gameId, voteSessionId }, payload: { abstain: true }
    });
  }
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SPY_RESULT');
  assert.equal(snapshot.view.session.publicModeState.lastResult.eliminatedMemberId, null);
});
