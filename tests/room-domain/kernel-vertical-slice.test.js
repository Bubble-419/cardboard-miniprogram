'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { COMMAND_TYPES, ERR, PROTOCOL_VERSION } = require('@cardboard/room-contracts');
const {
  createRoomApplication,
  createInMemoryRoomRepository
} = require('@cardboard/room-application');

function envelope(partial) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: partial.commandId || `cmd-${Math.random().toString(36).slice(2, 10)}`,
    ...partial
  };
}

describe('RoomKernel vertical slice CREATE/JOIN/LEAVE/REORDER', () => {
  it('creates room with host on seat 1', async () => {
    const repo = createInMemoryRoomRepository({
      generateRoomId: () => '10000001'
    });
    const app = createRoomApplication(repo);
    const res = await app.execute(
      envelope({ type: COMMAND_TYPES.CREATE_ROOM, payload: { nickName: '房主' } }),
      { userId: 'host-1' }
    );
    assert.equal(res.ok, true);
    assert.equal(res.roomId, '10000001');
    assert.equal(res.appliedRevision, 1);
    assert.equal(res.head.actor.role, 'HOST');
    assert.equal(res.head.actor.seatNo, 1);
  });

  it('joins allocate unique seats and rejects 7th', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '10000002' });
    const app = createRoomApplication(repo);
    const created = await app.execute(
      envelope({ commandId: 'create-room-02', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'u1' }
    );
    assert.equal(created.ok, true, created.errMsg);

    for (let i = 2; i <= 6; i += 1) {
      const r = await app.execute(
        envelope({
          commandId: `join-cmd-${i}`,
          type: COMMAND_TYPES.JOIN_ROOM,
          roomId: '10000002',
          payload: { nickName: `P${i}` }
        }),
        { userId: `u${i}` }
      );
      assert.equal(r.ok, true, r.errMsg);
      assert.equal(r.effects.seatNo, i);
    }
    const full = await app.execute(
      envelope({
        commandId: 'join-cmd-7',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '10000002',
        payload: {}
      }),
      { userId: 'u7' }
    );
    assert.equal(full.ok, false);
    assert.equal(full.errCode, ERR.ROOM_FULL);
  });

  it('is idempotent on same commandId', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '10000003' });
    const app = createRoomApplication(repo);
    const first = await app.execute(
      envelope({ commandId: 'same-cmd', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    const second = await app.execute(
      envelope({ commandId: 'same-cmd', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.appliedRevision, first.appliedRevision);
    assert.equal(repo.rooms.size, 1);
  });

  it('rejects host leave and supports dissolve', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '10000004' });
    const app = createRoomApplication(repo);
    const created = await app.execute(
      envelope({ commandId: 'dissolve-create', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    assert.equal(created.ok, true, created.errMsg);

    const leave = await app.execute(
      envelope({
        commandId: 'dissolve-leave',
        type: COMMAND_TYPES.LEAVE_ROOM,
        roomId: '10000004',
        expectedRevision: created.appliedRevision
      }),
      { userId: 'host' }
    );
    assert.equal(leave.ok, false);
    assert.equal(leave.errCode, ERR.HOST_CANNOT_LEAVE);

    const dissolved = await app.execute(
      envelope({
        commandId: 'dissolve-ok',
        type: COMMAND_TYPES.DISSOLVE_ROOM,
        roomId: '10000004',
        expectedRevision: created.appliedRevision
      }),
      { userId: 'host' }
    );
    assert.equal(dissolved.ok, true, dissolved.errMsg);
    assert.equal(dissolved.head.lifecycle, 'DISSOLVED');
  });

  it('reorders seats with revision check', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '10000005' });
    const app = createRoomApplication(repo);
    const created = await app.execute(
      envelope({ commandId: 'reorder-create', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    assert.equal(created.ok, true, created.errMsg);

    const joined = await app.execute(
      envelope({
        commandId: 'reorder-join',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '10000005',
        payload: { nickName: 'B' }
      }),
      { userId: 'player' }
    );
    assert.equal(joined.ok, true, joined.errMsg);

    const badRev = await app.execute(
      envelope({
        commandId: 'reorder-bad-rev',
        type: COMMAND_TYPES.REORDER_SEATS,
        roomId: '10000005',
        expectedRevision: 1,
        payload: { userIdOrder: ['player', 'host'] }
      }),
      { userId: 'host' }
    );
    assert.equal(badRev.ok, false);
    assert.equal(badRev.errCode, ERR.REVISION_CONFLICT);

    const ok = await app.execute(
      envelope({
        commandId: 'reorder-ok',
        type: COMMAND_TYPES.REORDER_SEATS,
        roomId: '10000005',
        expectedRevision: joined.appliedRevision,
        payload: { userIdOrder: ['player', 'host'] }
      }),
      { userId: 'host' }
    );
    assert.equal(ok.ok, true, ok.errMsg);
    const room = repo.rooms.get('10000005');
    assert.equal(room.seatMap['1'], 'player');
    assert.equal(room.seatMap['2'], 'host');
    assert.equal(room.membersByUserId.host.role, 'HOST');
    assert.equal(room.membersByUserId.host.seatNo, 2);
    assert.equal(room.membersByUserId.player.role, 'PLAYER');
    assert.equal(room.membersByUserId.player.seatNo, 1);
  });

  it('player leave frees seat for later join', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '10000006' });
    const app = createRoomApplication(repo);
    const created = await app.execute(
      envelope({ commandId: 'leave-create', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    assert.equal(created.ok, true, created.errMsg);

    const joined = await app.execute(
      envelope({
        commandId: 'leave-join-1',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '10000006',
        payload: {}
      }),
      { userId: 'p1' }
    );
    assert.equal(joined.ok, true, joined.errMsg);
    assert.equal(joined.effects.seatNo, 2);

    const left = await app.execute(
      envelope({
        commandId: 'leave-ok',
        type: COMMAND_TYPES.LEAVE_ROOM,
        roomId: '10000006',
        expectedRevision: joined.appliedRevision
      }),
      { userId: 'p1' }
    );
    assert.equal(left.ok, true, left.errMsg);

    const rejoin = await app.execute(
      envelope({
        commandId: 'leave-rejoin',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '10000006',
        payload: {}
      }),
      { userId: 'p2' }
    );
    assert.equal(rejoin.ok, true, rejoin.errMsg);
    assert.equal(rejoin.effects.seatNo, 2);
  });
});
