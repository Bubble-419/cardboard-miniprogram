'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { COMMAND_TYPES, ERR, PROTOCOL_VERSION } = require('@cardboard/room-contracts');
const {
  createRoomApplication,
  createInMemoryRoomRepository
} = require('@cardboard/room-application');
const { publicSpyGame } = require('../../packages/room-domain/spy');

function envelope(partial) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    commandId: partial.commandId || `cmd-${Math.random().toString(36).slice(2, 10)}`,
    ...partial
  };
}

const FIXED_PAIR = {
  id: 'pair_test',
  civilianWord: '平民词',
  civilianBlurb: '平民说明',
  spyWord: '卧底词',
  spyBlurb: '卧底说明'
};

describe('Spy SPY_START_ASSIGN / SPY_GET_MY_CARD', () => {
  async function seedThreePlayers(app) {
    await app.execute(
      envelope({ commandId: 'spy-create', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    await app.execute(
      envelope({
        commandId: 'spy-join-2',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '60000001',
        payload: {}
      }),
      { userId: 'p2' }
    );
    await app.execute(
      envelope({
        commandId: 'spy-join-3',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '60000001',
        payload: {}
      }),
      { userId: 'p3' }
    );
  }

  it('rejects assign with fewer than 3 players', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '60000001' });
    const app = createRoomApplication(repo, {
      wordPairPicker: () => FIXED_PAIR,
      random: () => 0
    });
    await app.execute(
      envelope({ commandId: 'spy-create-alone', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    const room = repo.rooms.get('60000001');
    const res = await app.execute(
      envelope({
        commandId: 'spy-assign-few',
        type: COMMAND_TYPES.SPY_START_ASSIGN,
        roomId: '60000001',
        expectedRevision: room.revision,
        payload: {}
      }),
      { userId: 'host' }
    );
    assert.equal(res.ok, false);
    assert.equal(res.errCode, ERR.NOT_ENOUGH_PLAYERS);
  });

  it('assigns roles into secrets and returns public spyGame without words', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '60000001' });
    const app = createRoomApplication(repo, {
      wordPairPicker: () => FIXED_PAIR,
      random: () => 0
    });
    await seedThreePlayers(app);
    const before = repo.rooms.get('60000001');

    const assign = await app.execute(
      envelope({
        commandId: 'spy-assign-ok',
        type: COMMAND_TYPES.SPY_START_ASSIGN,
        roomId: '60000001',
        expectedRevision: before.revision,
        payload: {}
      }),
      { userId: 'host' }
    );
    assert.equal(assign.ok, true, assign.errMsg);
    assert.equal(assign.spyGame.phase, 'speak');
    assert.equal(assign.spyGame.civilianWord, null);
    assert.equal(assign.spyGame.spyWord, null);
    assert.equal(assign.currentPage, 'spyspeak');

    const room = repo.rooms.get('60000001');
    assert.equal(room.spyGame.phase, 'speak');
    assert.equal(Object.keys(room.secretsByUserId).length, 3);
    // random()===0 的 shuffle：玩家序变为 [p2, p3, host]，首人为卧底
    assert.equal(room.secretsByUserId.p2.role, 'spy');
    assert.equal(room.secretsByUserId.p2.word, '卧底词');
    assert.equal(room.secretsByUserId.host.role, 'civilian');
    assert.equal(room.secretsByUserId.p3.role, 'civilian');
    assert.equal(room.secretsByUserId.host.word, '平民词');

    const pub = publicSpyGame(room.spyGame);
    assert.equal(pub.civilianWord, null);
    assert.equal(pub.spyWord, null);
  });

  it('returns own card only via SPY_GET_MY_CARD without writing', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '60000001' });
    const app = createRoomApplication(repo, {
      wordPairPicker: () => FIXED_PAIR,
      random: () => 0
    });
    await seedThreePlayers(app);
    const before = repo.rooms.get('60000001');
    await app.execute(
      envelope({
        commandId: 'spy-assign-for-card',
        type: COMMAND_TYPES.SPY_START_ASSIGN,
        roomId: '60000001',
        expectedRevision: before.revision,
        payload: {}
      }),
      { userId: 'host' }
    );
    const revAfterAssign = repo.rooms.get('60000001').revision;

    const card = await app.execute(
      envelope({
        commandId: 'spy-card-p2',
        type: COMMAND_TYPES.SPY_GET_MY_CARD,
        roomId: '60000001',
        payload: {}
      }),
      { userId: 'p2' }
    );
    assert.equal(card.ok, true, card.errMsg);
    assert.equal(card.card.role, 'spy');
    assert.equal(card.card.word, '卧底词');
    assert.equal(repo.rooms.get('60000001').revision, revAfterAssign);

    const missing = await app.execute(
      envelope({
        commandId: 'spy-card-outsider',
        type: COMMAND_TYPES.SPY_GET_MY_CARD,
        roomId: '60000001',
        payload: {}
      }),
      { userId: 'outsider' }
    );
    assert.equal(missing.ok, false);
    assert.equal(missing.errCode, ERR.NOT_MEMBER);
  });
});
