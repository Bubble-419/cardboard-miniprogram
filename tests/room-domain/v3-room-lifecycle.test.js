'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('../helpers/room-v3');

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
