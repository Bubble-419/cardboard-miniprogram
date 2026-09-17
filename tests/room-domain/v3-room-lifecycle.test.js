'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');
const { PROTOCOL_VERSION } = require('@cardboard/room-contracts');
const { createRoomApplication } = require('@cardboard/room-application');
const { createInMemoryRoomRepository } = require('../../packages/room-application/testing');

test('创建、并发式加入、席位、离开与解散走同一事务模型', async () => {
  const h = createHarness();
  const created = await h.command('host', 'CREATE_ROOM', { commandId: 'create-room', payload: { nickName: '房主' } });
  assert.equal(created.ok, true);
  assert.equal(created.outcome.roomId, '12345678');

  const joins = await Promise.all(Array.from({ length: 5 }, (_, index) =>
    h.command(`u${index + 2}`, 'JOIN_ROOM', { commandId: `join-${index + 2}`, knownSeq: 0,
      payload: { nickName: `玩家${index + 2}` } })));
  assert.equal(joins.every((item) => item.ok), true);
  const full = await h.command('u7', 'JOIN_ROOM', { payload: { nickName: '第七人' } });
  assert.equal(full.errCode, 'ROOM_FULL');

  let snapshot = await h.snapshot('host');
  assert.deepEqual(snapshot.view.room.members.map((item) => item.seatNo), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(snapshot.view.room.members.map((item) => item.memberId)).size, 6);

  const leavingMember = snapshot.view.room.members[2];
  const left = await h.command('u3', 'LEAVE_ROOM');
  assert.equal(left.outcome.kind, 'LEFT_ROOM');
  assert.equal((await h.app.readCurrentRoom({ userId: 'u3' })).roomId, null);
  await h.command('u7', 'JOIN_ROOM', { payload: { nickName: '新成员' } });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.room.members.find((item) => item.nickName === '新成员').seatNo, leavingMember.seatNo);

  const hostLeave = await h.command('host', 'LEAVE_ROOM');
  assert.equal(hostLeave.errCode, 'HOST_CANNOT_LEAVE');
  const dissolved = await h.command('host', 'DISSOLVE_ROOM');
  assert.equal(dissolved.outcome.kind, 'ROOM_DISSOLVED');
  assert.equal((await h.app.readCurrentRoom({ userId: 'u2' })).roomId, null);
  assert.equal((await h.snapshot('u2')).errCode, 'ROOM_DISSOLVED');
});

test('Receipt 与状态、事件一起幂等，复用 commandId 改 payload 会冲突', async () => {
  const h = createHarness();
  const input = { commandId: 'lost-create-response', payload: { nickName: '房主' } };
  const first = await h.command('host', 'CREATE_ROOM', input);
  const replay = await h.command('host', 'CREATE_ROOM', input);
  assert.deepEqual(replay.outcome, first.outcome);
  assert.equal(h.repo.rooms.size, 1);
  assert.equal(h.repo.events.get('12345678').length, 1);
  const conflict = await h.command('host', 'CREATE_ROOM', { ...input, payload: { nickName: '另一个名字' } });
  assert.equal(conflict.errCode, 'COMMAND_ID_CONFLICT');
});

test('重复加入不新增成员，并按 JOIN_ROOM payload 更新当前成员资料', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  const beforeMemberId = (await h.snapshot('u2')).view.actor.memberId;
  const joined = await h.command('u2', 'JOIN_ROOM', {
    payload: { nickName: '新昵称', avatarRef: 'cloud://avatar-2', avatarIndex: 3, color: '#112233' }
  });
  assert.equal(joined.ok, true);
  const snapshot = await h.snapshot('u2');
  const me = snapshot.view.room.members.find((member) => member.memberId === beforeMemberId);
  assert.equal(snapshot.view.room.members.length, 2);
  assert.deepEqual(me, {
    memberId: beforeMemberId,
    seatNo: 2,
    nickName: '新昵称',
    avatarRef: 'cloud://avatar-2',
    avatarIndex: 3,
    color: '#112233',
    joinedAt: me.joinedAt
  });
});

test('创建房间在同一事务内跳过已占用的确定性房间号', async () => {
  const repo = createInMemoryRoomRepository({
    generateRoomId: (commandId, userId, attempt) => {
      if (commandId === 'first') return '12345678';
      return attempt === 0 ? '12345678' : '87654321';
    }
  });
  const app = createRoomApplication(repo, { now: () => 1000, serverSecret: 'test-secret' });
  const create = (userId, commandId) => app.executeCommand({
    protocolVersion: PROTOCOL_VERSION, commandId, roomId: '', knownSeq: 0,
    type: 'CREATE_ROOM', context: {}, payload: { nickName: userId }
  }, { userId });

  assert.equal((await create('host-1', 'first')).outcome.roomId, '12345678');
  assert.equal((await create('host-2', 'second')).outcome.roomId, '87654321');
  assert.equal(repo.rooms.size, 2);
});

test('创建房间会在事务内忽略并修复悬挂的当前房间索引', async () => {
  const repo = createInMemoryRoomRepository({ generateRoomId: () => '12345678' });
  repo.activeRooms.set('host', '87654321');
  const app = createRoomApplication(repo, { now: () => 1000, serverSecret: 'test-secret' });

  const created = await app.executeCommand({
    protocolVersion: PROTOCOL_VERSION,
    commandId: 'create-after-dangling-active-room',
    roomId: '',
    knownSeq: 0,
    type: 'CREATE_ROOM',
    context: {},
    payload: { nickName: '房主' }
  }, { userId: 'host' });

  assert.equal(created.ok, true);
  assert.equal(created.outcome.roomId, '12345678');
  assert.equal(repo.activeRooms.get('host'), '12345678');
});

test('中途加入只成为 Room Member，不进入冻结的 Session Participant', async () => {
  const h = createHarness();
  let snapshot = await h.seedMembers(2);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  await h.command('u3', 'JOIN_ROOM', { payload: { nickName: '旁观者' } });
  snapshot = await h.snapshot('u3');
  assert.equal(snapshot.view.actor.isParticipant, false);
  assert.equal(snapshot.view.route.name, 'addPlayer');
  assert.equal(snapshot.view.session.participants.length, 2);
});

test('Partner 配置期成员离开会收缩门槛，被选首位离开会回到重选步骤', async () => {
  const h = createHarness();
  await h.seedMembers(4);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: {
    source: 'CUSTOM', scenario: { scene: '课堂', user: '学生', function: '协作', platform: '桌面' }
  } });
  await h.command('host', 'SUBMIT_DESIGN_PROBLEM', { context: { sessionId }, payload: { text: '问题1' } });
  await h.command('u2', 'SUBMIT_DESIGN_PROBLEM', { context: { sessionId }, payload: { text: '问题2' } });
  await h.command('u3', 'SUBMIT_DESIGN_PROBLEM', { context: { sessionId }, payload: { text: '问题3' } });
  await h.command('u4', 'LEAVE_ROOM');
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_DESIGN_PROBLEM');

  const problemId = snapshot.view.session.setup.designProblems[0].contributionId;
  await h.command('host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' }, payload: { contributionId: problemId }
  });
  const u2MemberId = (await h.snapshot('u2')).view.actor.memberId;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' }, payload: { memberId: u2MemberId }
  });
  await h.command('u2', 'LEAVE_ROOM');
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_FIRST_PLAYER');
  assert.equal(snapshot.view.session.setup.proposedFirstMemberId, null);
});

test('Partner 确认页返回后可重选首位，旧选择令牌不能覆盖新选择', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' }, payload: { source: 'OFFLINE' }
  });
  snapshot = await h.snapshot('host');
  const hostMemberId = snapshot.view.actor.memberId;
  const u2MemberId = (await h.snapshot('u2')).view.actor.memberId;
  const firstSelectionRevision = snapshot.view.session.workflow.revision;
  await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER', workflowRevision: firstSelectionRevision },
    payload: { memberId: hostMemberId }
  });
  assert.equal((await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'CONFIRM_FIRST_PLAYER' }, payload: { memberId: u2MemberId }
  })).ok, true);
  const stale = await h.command('host', 'SELECT_FIRST_PLAYER', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER', workflowRevision: firstSelectionRevision },
    payload: { memberId: hostMemberId }
  });
  assert.equal(stale.errCode, 'STALE_CONTEXT');
  await h.command('host', 'CONFIRM_FIRST_PLAYER', {
    context: { sessionId }, payload: { memberId: u2MemberId }
  });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.activeTurn.activeMemberId, u2MemberId);
});

test('Partner 配置页返回可安全更换情境，并原子清除旧问题事实', async () => {
  const h = createHarness();
  await h.seedMembers(3);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: { source: 'CUSTOM', scenario: {
      scene: '课堂', user: '学生', function: '协作', platform: '桌面'
    } }
  });
  await h.command('host', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '旧问题1' }
  });
  await h.command('u2', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '旧问题2' }
  });
  await h.command('u3', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '旧问题3' }
  });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.setup.designProblems.length, 3);

  const changed = await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' },
    payload: { source: 'OFFLINE' }
  });
  assert.equal(changed.ok, true);
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_FIRST_PLAYER');
  assert.equal(snapshot.view.session.setup.selectedProblem, null);
  assert.deepEqual(snapshot.view.session.setup.designProblems, []);
  assert.equal(Object.values(h.repo.rooms.get('12345678').facts.contributions)
    .filter((row) => row.sessionId === sessionId).length, 0);
});

test('Partner 后续配置步骤可返回重选问题，View 保留问题列表且旧步骤令牌失效', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  let snapshot = await h.snapshot('host');
  const sessionId = snapshot.view.session.sessionId;
  await h.command('host', 'SET_SCENARIO', {
    context: { sessionId, workflowStep: 'CHOOSE_SCENARIO' },
    payload: { source: 'CUSTOM', scenario: {
      scene: '教室', user: '教师', function: '授课', platform: '白板'
    } }
  });
  await h.command('host', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '问题A' }
  });
  await h.command('u2', 'SUBMIT_DESIGN_PROBLEM', {
    context: { sessionId }, payload: { text: '问题B' }
  });
  snapshot = await h.snapshot('host');
  const [problemA, problemB] = snapshot.view.session.setup.designProblems;
  await h.command('host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' },
    payload: { contributionId: problemA.contributionId }
  });
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.setup.designProblems.length, 2);

  const reselection = await h.command('host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_FIRST_PLAYER' },
    payload: { contributionId: problemB.contributionId }
  });
  assert.equal(reselection.ok, true);
  snapshot = await h.snapshot('host');
  assert.equal(snapshot.view.session.setup.selectedProblem.contributionId, problemB.contributionId);
  assert.equal(snapshot.view.session.workflow.step, 'SELECT_FIRST_PLAYER');
  const stale = await h.command('host', 'SELECT_DESIGN_PROBLEM', {
    context: { sessionId, workflowStep: 'SELECT_DESIGN_PROBLEM' },
    payload: { contributionId: problemA.contributionId }
  });
  assert.equal(stale.errCode, 'STALE_CONTEXT');
});

test('房间解散后参与者仍可鉴权读取已取消的归档场次', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  await h.command('host', 'START_WORKSHOP_SESSION', { payload: { mode: 'PARTNER' } });
  const sessionId = (await h.snapshot('host')).view.session.sessionId;
  await h.command('host', 'DISSOLVE_ROOM');
  assert.equal((await h.snapshot('u2')).errCode, 'ROOM_DISSOLVED');
  const archived = await h.app.readSessionSnapshot('12345678', sessionId, { userId: 'u2' });
  assert.equal(archived.ok, true);
  assert.equal(archived.view.room.lifecycle, 'DISSOLVED');
  assert.equal(archived.view.session.status, 'CANCELLED');
  assert.equal(archived.view.actor.capabilities.UPDATE_MEMBER_PROFILE.allowed, false);
});

test('房间文档丢失后会释放卡住的当前房间索引，允许再创建', async () => {
  const h = createHarness();
  await h.seedMembers(2);
  h.repo.rooms.delete('12345678');

  const current = await h.app.readCurrentRoom({ userId: 'u2' });
  assert.equal(current.ok, true);
  assert.equal(current.roomId, null);
  assert.equal(h.repo.activeRooms.has('u2'), false);

  const created = await h.command('u2', 'CREATE_ROOM', { payload: { nickName: '新房主' } });
  assert.equal(created.ok, true);
  assert.equal(created.outcome.kind, 'ROOM_CREATED');
});

test('房间已解散但索引残留时视为未加入，允许加入其他房间', async () => {
  const h = createHarness({
    generateRoomId: (_commandId, _userId, attempt) => (attempt === 0 ? '12345678' : '87654321')
  });
  await h.seedMembers(2);
  await h.command('host', 'DISSOLVE_ROOM');
  h.repo.activeRooms.set('u2', '12345678');

  const current = await h.app.readCurrentRoom({ userId: 'u2' });
  assert.equal(current.ok, true);
  assert.equal(current.roomId, null);

  const other = await h.command('u3', 'CREATE_ROOM', { payload: { nickName: '另一房主' } });
  assert.equal(other.ok, true);
  assert.equal(other.outcome.roomId, '87654321');

  const joined = await h.command('u2', 'JOIN_ROOM', {
    roomId: '87654321',
    payload: { nickName: '从残留索引加入' }
  });
  assert.equal(joined.ok, true);
  assert.equal(joined.outcome.kind, 'ROOM_JOINED');
  assert.equal(joined.outcome.roomId, '87654321');
});

test('仍在开放房间时不能创建或加入另一个房间', async () => {
  const h = createHarness({
    generateRoomId: (_commandId, _userId, attempt) => (attempt === 0 ? '12345678' : '87654321')
  });
  await h.seedMembers(2);
  assert.equal((await h.command('u2', 'CREATE_ROOM', { payload: { nickName: '抢房' } })).errCode, 'ALREADY_IN_ROOM');
  const other = await h.command('u3', 'CREATE_ROOM', { payload: { nickName: '另一房主' } });
  assert.equal(other.ok, true);
  assert.equal((await h.command('u2', 'JOIN_ROOM', {
    roomId: other.outcome.roomId,
    payload: { nickName: '跨房加入' }
  })).errCode, 'ALREADY_IN_ROOM');
});
