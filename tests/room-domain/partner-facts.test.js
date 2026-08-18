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

  it('ADVANCE_TURN archives finishing player and increments round per turn', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);
    const room = repo.rooms.get('30000001');
    room.currentPlayerIndex = 1;
    room.currentPlayerName = '玩家1';
    room.currentRound = 1;
    room.partnerRoundSummaries = [];
    room.partnerCurrentRoundContent = {
      playHistory: ['玩家1的出牌解释'],
      discussionNotes: [],
      playImages: [],
      discussionImages: [],
      playBlocks: [],
      discussionBlocks: [],
      voiceLines: [],
      turnRecords: []
    };
    room.revision = (room.revision || 1) + 1;
    repo.rooms.set('30000001', room);

    const adv = await app.execute(
      envelope({
        commandId: 'p5-adv-archive',
        type: COMMAND_TYPES.ADVANCE_TURN,
        roomId: '30000001',
        expectedRevision: room.revision
      }),
      { userId: 'host' }
    );
    assert.equal(adv.ok, true, adv.errMsg);
    const next = repo.rooms.get('30000001');
    assert.equal(next.currentPlayerIndex, 2);
    assert.equal(next.currentRound, 2);
    assert.equal(adv.effects.incrementRound, true);
    assert.equal(next.partnerRoundSummaries.length, 1);
    assert.equal(next.partnerRoundSummaries[0].playerIndex, 1);
    assert.equal(next.partnerRoundSummaries[0].round, 1);
    assert.deepEqual(next.partnerRoundSummaries[0].playHistory, ['玩家1的出牌解释']);
    assert.deepEqual(next.partnerCurrentRoundContent.playHistory, []);
  });

  it('ADVANCE_TURN refreshes round timer on every turn advance', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);
    const room = repo.rooms.get('30000001');
    const staleTs = Date.now() - 30_000;
    room.partnerRoundStartedAt = staleTs;
    room.partnerTurnStartedAt = staleTs;
    room.currentPlayerIndex = 1;
    room.revision = (room.revision || 1) + 1;
    repo.rooms.set('30000001', room);

    const before = Date.now();
    const adv = await app.execute(
      envelope({
        commandId: 'p5-adv-timer',
        type: COMMAND_TYPES.ADVANCE_TURN,
        roomId: '30000001',
        expectedRevision: room.revision
      }),
      { userId: 'host' }
    );
    assert.equal(adv.ok, true, adv.errMsg);
    const next = repo.rooms.get('30000001');
    assert.equal(next.currentPlayerIndex, 2);
    assert.notEqual(next.partnerRoundStartedAt, staleTs);
    assert.ok(Number(next.partnerRoundStartedAt) >= before);
    assert.equal(next.partnerTurnStartedAt, next.partnerRoundStartedAt);
  });

  it('ADVANCE_TURN prefers currentPlayerIndex when workflow.activeSeatNo lags', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);
    const room = repo.rooms.get('30000001');
    // 模拟表态后 legacy 已把出牌人写成 2，但 workflow 仍停在座位 1
    room.currentPlayerIndex = 2;
    room.currentPlayerName = '玩家2';
    room.partnerGamePhase = 'discussion';
    room.workflow = {
      mode: 'PARTNER',
      step: 'STATEMENT',
      roundNo: 1,
      activeSeatNo: 1,
      turnId: 'turn_r1_s1',
      legacyPage: 'statement'
    };
    room.revision = (room.revision || 1) + 1;
    repo.rooms.set('30000001', room);

    const adv = await app.execute(
      envelope({
        commandId: 'p5-adv-lag',
        type: COMMAND_TYPES.ADVANCE_TURN,
        roomId: '30000001',
        expectedRevision: room.revision,
        payload: { incrementRound: true }
      }),
      { userId: 'host' }
    );
    assert.equal(adv.ok, true, adv.errMsg);
    const next = repo.rooms.get('30000001');
    // 应从 2 前进到 1（两人房绕圈），而不是从滞后的 1「前进」到已是当前的 2
    assert.equal(next.currentPlayerIndex, 1);
    assert.equal(next.workflow.activeSeatNo, 1);
    assert.equal(next.partnerGamePhase, 'play');
  });

  it('rejects START_STATEMENT when progress belongs to previous turn', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);
    const room = repo.rooms.get('30000001');
    // 模拟表态后换人但未清 progress：席位已是 2，progress 仍是 turn_r1_s1 满分
    room.currentPlayerIndex = 2;
    room.workflow = {
      mode: 'PARTNER',
      step: 'TURN_ACTIVE',
      roundNo: 1,
      activeSeatNo: 2,
      turnId: 'turn_r1_s2'
    };
    room.progress = {
      scoredCount: 1,
      requiredScoreCount: 1,
      votedCount: 0,
      requiredVoteCount: 0,
      turnId: 'turn_r1_s1'
    };
    room.revision = (room.revision || 1) + 1;
    const stmt = await app.execute(
      envelope({
        commandId: 'p5-stmt-stale',
        type: COMMAND_TYPES.START_STATEMENT,
        roomId: '30000001',
        expectedRevision: room.revision
      }),
      { userId: 'host' }
    );
    assert.equal(stmt.ok, false);
    assert.equal(stmt.errCode, ERR.INVALID_TRANSITION);
  });

  it('ADVANCE_TURN archives acting player (not next player) in round summary', async () => {
    const repo = createInMemoryRoomRepository({ generateRoomId: () => '30000001' });
    const app = createRoomApplication(repo);
    await seedActivePartnerRoom(app, repo);
    const room = repo.rooms.get('30000001');
    // 玩家1正在出牌
    room.currentPlayerIndex = 1;
    room.currentPlayerName = '玩家1';
    room.currentRound = 1;
    room.partnerRoundSummaries = [];
    room.partnerCurrentRoundContent = {
      playHistory: ['玩家1的出牌说明'],
      discussionNotes: ['疑问讨论内容'],
      playImages: [],
      discussionImages: [],
      playBlocks: [],
      discussionBlocks: [],
      voiceLines: [],
      turnRecords: []
    };
    room.revision = (room.revision || 1) + 1;
    repo.rooms.set('30000001', room);

    // 房主调用 ADVANCE_TURN（模拟表态全部通过后换人）
    const adv = await app.execute(
      envelope({
        commandId: 'stmt-pass-adv',
        type: COMMAND_TYPES.ADVANCE_TURN,
        roomId: '30000001',
        expectedRevision: room.revision,
        payload: { incrementRound: false }
      }),
      { userId: 'host' }
    );
    assert.equal(adv.ok, true, adv.errMsg);
    const next = repo.rooms.get('30000001');
    // 应进入玩家2
    assert.equal(next.currentPlayerIndex, 2);
    // 纪要应归档玩家1的行动（不是玩家2）
    assert.equal(next.partnerRoundSummaries.length, 1, '应有且仅有一条纪要');
    assert.equal(next.partnerRoundSummaries[0].playerIndex, 1, '纪要归档的是出牌玩家1');
    assert.equal(next.partnerRoundSummaries[0].round, 1);
    assert.deepEqual(next.partnerRoundSummaries[0].playHistory, ['玩家1的出牌说明']);
    // 清空当前轮内容
    assert.deepEqual(next.partnerCurrentRoundContent.playHistory, []);
  });
});
