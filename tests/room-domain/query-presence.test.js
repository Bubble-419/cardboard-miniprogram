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

describe('roomQuery head/snapshot and presence', () => {
  it('readHead is side-effect free on revision', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '20000001' });
    const app = createRoomApplication(repo);
    await app.execute(
      envelope({ commandId: 'q-create', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    const before = repo.rooms.get('20000001').revision;
    const head1 = await app.readHead('20000001', { userId: 'host' });
    const head2 = await app.readHead('20000001', { userId: 'host' });
    assert.equal(head1.ok, true);
    assert.equal(head2.ok, true);
    assert.equal(head1.head.revision, before);
    assert.equal(repo.rooms.get('20000001').revision, before);
    assert.ok(head1.head.capabilities);
    assert.equal(head1.head.actor.role, 'HOST');
  });

  it('snapshot returns members without openids and respects domain revisions', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '20000002' });
    const app = createRoomApplication(repo);
    await app.execute(
      envelope({ commandId: 'q-create-2', type: COMMAND_TYPES.CREATE_ROOM, payload: { nickName: 'H' } }),
      { userId: 'host' }
    );
    await app.execute(
      envelope({
        commandId: 'q-join-2',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '20000002',
        payload: { nickName: 'P' }
      }),
      { userId: 'player' }
    );

    const full = await app.readSnapshot('20000002', { userId: 'player' }, {
      domains: ['members']
    });
    assert.equal(full.ok, true);
    assert.ok(full.snapshot.domains.members);
    const people = full.snapshot.domains.members.data;
    assert.equal(people.length, 2);
    people.forEach((p) => {
      assert.equal(Object.prototype.hasOwnProperty.call(p, 'userId'), false);
    });

    const membersRev = full.snapshot.domains.members.revision;
    const cached = await app.readSnapshot('20000002', { userId: 'player' }, {
      domains: ['members'],
      domainRevisions: { members: membersRev }
    });
    assert.equal(cached.ok, true);
    assert.equal(cached.snapshot.domains.members, undefined);
  });

  it('rejects non-member query', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '20000003' });
    const app = createRoomApplication(repo);
    await app.execute(
      envelope({ commandId: 'q-create-3', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    const denied = await app.readHead('20000003', { userId: 'stranger' });
    assert.equal(denied.ok, false);
    assert.equal(denied.errCode, ERR.NOT_MEMBER);
  });

  it('heartbeat does not bump room revision', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '20000004' });
    const app = createRoomApplication(repo);
    const created = await app.execute(
      envelope({ commandId: 'q-create-4', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    const hb = await app.heartbeat('20000004', { userId: 'host' }, { deviceSessionId: 'dev1' });
    assert.equal(hb.ok, true);
    assert.equal(hb.revision, created.appliedRevision);
    assert.equal(repo.rooms.get('20000004').revision, created.appliedRevision);
    assert.equal(repo.presence.size, 1);
  });
});
