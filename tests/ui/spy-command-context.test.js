'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  captureSpyCommandContext,
  spyCommandContextForAction
} = require('../../packageSpy/utils/spyMode');

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

  assert.deepEqual(spyCommandContextForAction('finishSpeak', captured), {
    sessionId: 'session-old', gameId: 'game-old', speakerTurnId: 'speaker-old'
  });
  assert.deepEqual(spyCommandContextForAction('submitVote', captured), {
    sessionId: 'session-old', gameId: 'game-old', voteSessionId: 'vote-old'
  });
  assert.deepEqual(spyCommandContextForAction('startQuestion', captured), {
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

test('Spy 当前发言者可在页面结束发言并推进顺序', () => {
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'packageSpy/pages/speak/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'packageSpy/pages/speak/index.wxml'), 'utf8');
  assert.match(source, /callSpyAction\('finishSpeak'/);
  assert.match(source, /onFinishSpeak/);
  assert.doesNotMatch(source, /onStartVote|startVote|OPEN_SPY_VOTE/);
  assert.match(template, /wx:if="\{\{isCurrentSpeaker\}\}"/);
  assert.match(template, /bindtap="onFinishSpeak"/);
  assert.doesNotMatch(template, /开始投票|onStartVote/);
  assert.match(template, /全员完成发言后系统自动进入投票/);
});

test('Spy 发言页向全体非发言玩家展示当前发言人提示', () => {
  const root = path.resolve(__dirname, '../..');
  const source = fs.readFileSync(path.join(root, 'packageSpy/pages/speak/index.js'), 'utf8');
  const template = fs.readFileSync(path.join(root, 'packageSpy/pages/speak/index.wxml'), 'utf8');
  assert.match(source, /currentSpeakerName:/);
  assert.match(template, /\{\{waitingHintPrefix\}\}：\{\{currentSpeakerName\}\}/);
  assert.match(template, /wx:if="\{\{!isCurrentSpeaker && currentSpeakerName\}\}"/);
  assert.doesNotMatch(template, /isHost && !isCurrentSpeaker && currentSpeakerName/);
  assert.match(
    template,
    /wx:if="\{\{isCurrentSpeaker \|\| currentSpeakerName\}\}"/
  );
});

test('Spy 投票页房主可开启提问轮，提问页复用发言壳', () => {
  const root = path.resolve(__dirname, '../..');
  const voteJs = fs.readFileSync(path.join(root, 'packageSpy/pages/vote/index.js'), 'utf8');
  const voteWxml = fs.readFileSync(path.join(root, 'packageSpy/pages/vote/index.wxml'), 'utf8');
  const speakWxml = fs.readFileSync(path.join(root, 'packageSpy/pages/speak/index.wxml'), 'utf8');
  assert.match(voteJs, /callSpyAction\('startQuestion'/);
  assert.match(voteJs, /START_SPY_QUESTION_ROUND/);
  assert.match(voteWxml, /进行提问|question-btn-line">进行[\s\S]*question-btn-line">提问/);
  assert.match(voteWxml, /bindtap="onStartQuestion"/);
  assert.match(speakWxml, /每人最多提出一个问题/);
  assert.match(speakWxml, /\{\{finishActionText\}\}/);
});
