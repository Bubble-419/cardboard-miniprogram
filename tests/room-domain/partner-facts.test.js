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

describe('Partner SUBMIT_SCORE / POST_MESSAGE / ADVANCE_TURN', () => {
  async function seedActivePartnerRoom(app, repo) {
    await app.execute(
      envelope({ commandId: 'p5-create', type: COMMAND_TYPES.CREATE_ROOM, payload: {} }),
      { userId: 'host' }
    );
    await app.execute(
      envelope({
        commandId: 'p5-join',
        type: COMMAND_TYPES.JOIN_ROOM,
        roomId: '30000001',
        payload: {}
      }),
      { userId: 'p2' }
    );
    // 手动进入 Partner turn（模拟 START_SESSION 后）
    const room = repo.rooms.get('30000001');
    room.lifecycle = 'ACTIVE';
    room.workflow = {
      mode: 'PARTNER',
      step: 'TURN_ACTIVE',
      roundNo: 1,
      activeSeatNo: 1,
      turnId: 'turn_r1_s1'
    };
    room.progress = {
      scoredCount: 0,
      requiredScoreCount: 1,
      votedCount: 0,
      requiredVoteCount: 0,
      turnId: 'turn_r1_s1'
    };
    repo.rooms.set('30000001', room);
  }

  it('rejects self score and accepts other member score', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);

    const self = await app.execute(
      envelope({
        commandId: 'p5-self-score',
        type: COMMAND_TYPES.SUBMIT_SCORE,
        roomId: '30000001',
        payload: { score: 4, activeSeatNo: 1 }
      }),
      { userId: 'host' }
    );
    assert.equal(self.ok, false);
    assert.equal(self.errCode, ERR.SELF_SCORE);

    const ok = await app.execute(
      envelope({
        commandId: 'p5-score-ok',
        type: COMMAND_TYPES.SUBMIT_SCORE,
        roomId: '30000001',
        payload: { score: 5, activeSeatNo: 1 }
      }),
      { userId: 'p2' }
    );
    assert.equal(ok.ok, true, ok.errMsg);
    assert.equal(ok.effects.scoredCount, 1);
    assert.equal(ok.head.progress.scoredCount, 1);
  });

  it('posts message without requiring expectedRevision', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);
    const msg = await app.execute(
      envelope({
        commandId: 'p5-msg-1',
        type: COMMAND_TYPES.POST_MESSAGE,
        roomId: '30000001',
        payload: { text: 'hello', messageId: 'm1' }
      }),
      { userId: 'p2' }
    );
    assert.equal(msg.ok, true, msg.errMsg);
    assert.equal(repo.rooms.get('30000001').messages.length, 1);
  });

  it('host can start statement after scores complete and advance turn', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);
    await app.execute(
      envelope({
        commandId: 'p5-score-2',
        type: COMMAND_TYPES.SUBMIT_SCORE,
        roomId: '30000001',
        payload: { score: 3, activeSeatNo: 1 }
      }),
      { userId: 'p2' }
    );
    const roomBefore = repo.rooms.get('30000001');
    const stmt = await app.execute(
      envelope({
        commandId: 'p5-stmt',
        type: COMMAND_TYPES.START_STATEMENT,
        roomId: '30000001',
        expectedRevision: roomBefore.revision
      }),
      { userId: 'host' }
    );
    assert.equal(stmt.ok, true, stmt.errMsg);
    assert.equal(stmt.effects.legacyPage, 'statement');
    assert.equal(repo.rooms.get('30000001').currentPage, 'statement');

    const afterStmt = repo.rooms.get('30000001');
    const adv = await app.execute(
      envelope({
        commandId: 'p5-adv',
        type: COMMAND_TYPES.ADVANCE_TURN,
        roomId: '30000001',
        expectedRevision: afterStmt.revision
      }),
      { userId: 'host' }
    );
    assert.equal(adv.ok, true, adv.errMsg);
    assert.equal(adv.effects.activeSeatNo, 2);
    assert.equal(adv.head.progress.scoredCount, 0);
    assert.equal(repo.rooms.get('30000001').currentPlayerIndex, 2);
    assert.equal(repo.rooms.get('30000001').currentPage, 'gamepage');
    assert.equal(repo.rooms.get('30000001').partnerGamePhase, 'play');
  });
});
