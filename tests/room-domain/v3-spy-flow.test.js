'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');

async function seedSpy() {
  const h = createHarness({ wordPairPicker: () => ({ id: 'fixed', civilianWord: '苹果', civilianBlurb: '水果', spyWord: '梨', spyBlurb: '另一种水果' }) });
  await h.seedMembers(3);
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
  const preSettleEvents = h.repo.events.get('12345678');
  assert.equal(JSON.stringify(preSettleEvents).includes('苹果'), false);
  assert.equal(JSON.stringify(preSettleEvents).includes('"梨"'), false);
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
  await h.command('u2', 'START_NEXT_SPY_ROUND', { context: { sessionId, gameId } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.publicModeState.roundNo, 2);
  assert.equal(snapshot.view.session.workflow.step, 'SPY_SPEAK');
});
