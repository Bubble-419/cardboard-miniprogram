'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PROTOCOL_VERSION, COMMAND_TYPES, COMMAND_CONTEXT, validateCommandEnvelope, validateMemberView
} = require('@cardboard/room-contracts');

function envelope(type, fields) {
  return { protocolVersion: PROTOCOL_VERSION, commandId: 'cmd-1', roomId: '12345678', knownSeq: 0,
    type, context: {}, payload: {}, ...(fields || {}) };
}

test('V3 CREATE_ROOM 不需要 roomId，knownSeq 不参与并发裁决', () => {
  const create = validateCommandEnvelope(envelope(COMMAND_TYPES.CREATE_ROOM, { roomId: '' }));
  assert.equal(create.ok, true);
  const leave = validateCommandEnvelope(envelope(COMMAND_TYPES.LEAVE_ROOM, { knownSeq: 999 }));
  assert.equal(leave.ok, true);
  assert.equal(Object.hasOwn(leave.envelope, 'expectedRevision'), false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.CREATE_ROOM, { roomId: '12345678' })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.CREATE_ROOM, { roomId: 12345678 })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM, { roomId: 12345678 })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM, { protocolVersion: '3' })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM, { knownSeq: '0' })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM, { roomId: '../room' })).ok, false);
});

test('按命令注册表验证精确上下文令牌', () => {
  const invalid = validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE,
    { payload: { scoreHalfSteps: 7 }, context: { sessionId: 's1' } }));
  assert.equal(invalid.ok, false);
  assert.match(invalid.errMsg, /turnId/);
  const valid = validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE,
    { payload: { scoreHalfSteps: 7 }, context: { sessionId: 's1', turnId: 't1' } }));
  assert.equal(valid.ok, true);
  assert.deepEqual(COMMAND_CONTEXT.SUBMIT_SPY_VOTE, ['sessionId', 'gameId', 'voteSessionId']);
  assert.deepEqual(COMMAND_CONTEXT.OPEN_SPY_VOTE, ['sessionId', 'gameId', 'speakerTurnId']);
  assert.deepEqual(COMMAND_CONTEXT.START_NEXT_SPY_ROUND, ['sessionId', 'gameId', 'roundNo']);
  assert.deepEqual(COMMAND_CONTEXT.APPEND_ARTIFACT, ['sessionId', 'turnId', 'workflowStep']);
  assert.deepEqual(COMMAND_CONTEXT.RESET_FIRST_PLAYER, ['sessionId', 'workflowRevision']);
  assert.deepEqual(COMMAND_CONTEXT.RESET_DESIGN_PROBLEM, ['sessionId', 'workflowRevision']);
  assert.deepEqual(COMMAND_CONTEXT.RESET_SCENARIO, ['sessionId', 'workflowRevision']);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.RESET_FIRST_PLAYER, {
    context: { sessionId: 's1', workflowRevision: 1 }
  })).ok, true);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.RESET_DESIGN_PROBLEM, {
    context: { sessionId: 's1', workflowRevision: 1 }
  })).ok, true);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.RESET_SCENARIO, {
    context: { sessionId: 's1', workflowRevision: 1 }
  })).ok, true);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.APPEND_ARTIFACT, {
    context: { sessionId: 's1', turnId: 't1' }, payload: { operationId: 'op', text: 'x' }
  })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.START_NEXT_SPY_ROUND, {
    context: { sessionId: 's1', gameId: 'g1', roundNo: '1' }
  })).ok, false);
});

test('拒绝未知协议、未知命令和非法半星值', () => {
  assert.equal(validateCommandEnvelope(envelope('PATCH_ROOM')).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM, { protocolVersion: 2 })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE,
    { payload: { scoreHalfSteps: 7.5 }, context: { sessionId: 's', turnId: 't' } })).ok, false);
});

test('指令、context 与 payload 都拒绝未知或模糊结构', () => {
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.LEAVE_ROOM,
    { expectedRevision: 3 })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.LEAVE_ROOM,
    { context: [], payload: {} })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.LEAVE_ROOM,
    { context: {}, payload: [] })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM,
    { payload: { legacyRole: 'GOD' } })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM,
    { payload: { avatarUrl: 'https://example.test/avatar.png' } })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM,
    { payload: { avatarRef: 'https://example.test/avatar.png' } })).ok, true);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM,
    { payload: { color: 'red' } })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.JOIN_ROOM,
    { payload: { nickName: { text: '伪昵称' } } })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.UPDATE_MEMBER_PROFILE,
    { payload: { avatarIndex: '1' } })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE, {
    context: { sessionId: 's', turnId: 't' }, payload: { scoreHalfSteps: '7' }
  })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.APPEND_ARTIFACT, {
    context: { sessionId: 's', turnId: 't', workflowStep: 'PARTNER_TURN' },
    payload: { operationId: 'op', text: { value: '伪素材' } }
  })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_PARTNER_SCORE, {
    context: { sessionId: 's', turnId: 't', revision: 3 },
    payload: { scoreHalfSteps: 7 }
  })).ok, false);
});

test('校验嵌套情境、全量席位与语义枚举', () => {
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.SET_SCENARIO, {
    context: { sessionId: 's', workflowStep: 'CHOOSE_SCENARIO', workflowRevision: 1 },
    payload: { source: 'CUSTOM', scenario: { scene: '场景', user: '用户', function: '功能', secret: 'x' } }
  })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.REORDER_SEATS, {
    payload: { orderedMemberIds: ['m1', 'm1'] }
  })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.START_PARTNER_STATEMENT, {
    context: { sessionId: 's', turnId: 't' }, payload: { statementResult: 'unknown' }
  })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.START_PARTNER_STATEMENT, {
    context: { sessionId: 's', turnId: 't' }, payload: { statementResult: 'partialPass' }
  })).ok, true);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.ADVANCE_PARTNER_TURN, {
    context: { sessionId: 's', turnId: 't' }, payload: {}
  })).ok, true);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.SET_SCENARIO, {
    context: { sessionId: 's', workflowStep: 'CHOOSE_SCENARIO', workflowRevision: 1 },
    payload: { source: 'CUSTOM', scenario: { scene: '场景', user: '用户', function: '功能' } }
  })).ok, true);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.CONFIRM_FIRST_PLAYER, {
    context: { sessionId: 's', workflowRevision: 1 }, payload: {}
  })).ok, false);
  assert.equal(validateCommandEnvelope(envelope(COMMAND_TYPES.SUBMIT_SPY_VOTE, {
    context: { sessionId: 's', gameId: 'g', voteSessionId: 'v' },
    payload: { abstain: true, targetMemberId: 'm2' }
  })).ok, false);
});

test('MemberView 必须包含页面可独立恢复所需的完整稳定骨架', () => {
  const view = {
    room: {
      roomId: '12345678', lifecycle: 'OPEN', workshopName: '工作坊', createdAt: 1,
      hostMemberId: 'member-1',
      members: [{
        memberId: 'member-1', seatNo: 1, nickName: '房主', avatarRef: null,
        avatarIndex: null, color: '#5EC159', joinedAt: 1
      }]
    },
    session: {
      sessionId: 'session-1', ordinal: 1, status: 'RUNNING', mode: 'HALLI_GALLI',
      participants: [{
        memberId: 'member-1', seatNoAtStart: 1, status: 'ACTIVE', nickName: '房主',
        avatarRef: null, avatarIndex: null, color: '#5EC159'
      }],
      setup: {
        scenarioSource: 'OFFLINE', scenario: null, proposedFirstMemberId: 'member-1',
        selectedProblem: null, designProblems: []
      },
      workflow: { step: 'HALLI_ACTIVITY', revision: 1 }, progress: {},
      publicModeState: { firstMemberId: 'member-1', submittedMemberIds: [], ideas: [] },
      activeTurn: null, activeArtifacts: [], recentMessages: [], turnSummaries: [], result: null
    },
    actor: {
      memberId: 'member-1', role: 'HOST', seatNo: 1, isParticipant: true,
      contributionStatus: { submitted: false }, scoreStatus: { submitted: false },
      voteStatus: { submitted: false }, privateModeState: null,
      capabilities: { END_HALLI_ACTIVITY: { allowed: true, reason: null } }
    },
    route: { name: 'halliGame', params: {} },
    navigation: { back: { kind: 'NONE' } }
  };
  assert.equal(validateMemberView(view, '12345678'), true);

  const withProblem = JSON.parse(JSON.stringify(view));
  withProblem.session.setup.designProblems = [{
    contributionId: 'problem-1', memberId: 'member-1', text: '设计问题',
    entityVersion: 1, createdAt: 10
  }];
  withProblem.session.setup.selectedProblem = { ...withProblem.session.setup.designProblems[0] };
  assert.equal(validateMemberView(withProblem, '12345678'), true);
  delete withProblem.session.setup.designProblems[0].createdAt;
  assert.equal(validateMemberView(withProblem, '12345678'), false,
    '设计问题缺少首次提交时间时必须拒绝，避免客户端顺序漂移');

  const missingCases = [
    ['room.members', (copy) => { delete copy.room.members; }],
    ['room.hostMemberId', (copy) => { delete copy.room.hostMemberId; }],
    ['actor.scoreStatus', (copy) => { delete copy.actor.scoreStatus; }],
    ['actor.isParticipant', (copy) => { delete copy.actor.isParticipant; }],
    ['navigation.back', (copy) => { delete copy.navigation.back; }],
    ['session.workflow.revision', (copy) => { delete copy.session.workflow.revision; }],
    ['session.setup.designProblems', (copy) => { delete copy.session.setup.designProblems; }],
    ['session.activeTurn', (copy) => { delete copy.session.activeTurn; }],
    ['session.result', (copy) => { delete copy.session.result; }]
  ];
  missingCases.forEach(([label, mutate]) => {
    const copy = JSON.parse(JSON.stringify(view));
    mutate(copy);
    assert.equal(validateMemberView(copy, '12345678'), false, `${label} 缺失时必须拒绝`);
  });

  const invalidBackCases = [
    { kind: 'COMMAND', commandType: 'CREATE_ROOM', context: {}, after: 'FOLLOW_ROUTE' },
    { kind: 'COMMAND', commandType: 'RESET_FIRST_PLAYER', context: { sessionId: 's1' }, after: 'FOLLOW_ROUTE' },
    { kind: 'COMMAND', commandType: 'RESET_FIRST_PLAYER',
      context: { sessionId: 's1', workflowRevision: 1 }, after: 'OPEN_MODE_PICKER' },
    { kind: 'NONE', after: 'FOLLOW_ROUTE' }
  ];
  invalidBackCases.forEach((back) => {
    const copy = JSON.parse(JSON.stringify(view));
    copy.navigation.back = back;
    assert.equal(validateMemberView(copy, '12345678'), false, `非法 back 投影必须拒绝: ${JSON.stringify(back)}`);
  });
});
