'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  captureSpyCommandContext,
  spyCommandContextForAction
} = require('../../utils/spyMode');

test('Spy 写指令使用页面已渲染的并发令牌，不被后来 Snapshot 偷换', () => {
  const rendered = {
    view: { session: { sessionId: 'session-old' } },
    roomState: { spyGame: {
      gameId: 'game-old', speakerTurnId: 'speaker-old', voteSessionId: 'vote-old', roundNo: 2
    } }
  };
  const captured = captureSpyCommandContext(rendered);
  rendered.view.session.sessionId = 'session-new';
  rendered.roomState.spyGame.speakerTurnId = 'speaker-new';
  rendered.roomState.spyGame.voteSessionId = 'vote-new';

  assert.deepEqual(spyCommandContextForAction('startVote', captured), {
    sessionId: 'session-old', gameId: 'game-old', speakerTurnId: 'speaker-old'
  });
  assert.deepEqual(spyCommandContextForAction('submitVote', captured), {
    sessionId: 'session-old', gameId: 'game-old', voteSessionId: 'vote-old'
  });
  assert.deepEqual(spyCommandContextForAction('nextRound', captured), {
    sessionId: 'session-old', gameId: 'game-old', roundNo: 2
  });
});

test('NOT_MEMBER 与解散/不存在一样属于 Room View 终态', () => {
  const { isRemovedFromRoomResult } = require('../../utils/roomDissolved');
  assert.equal(isRemovedFromRoomResult({ errCode: 'NOT_MEMBER' }), true);
  assert.equal(isRemovedFromRoomResult({ errCode: 'NOT_IN_ROOM' }), true);
});
