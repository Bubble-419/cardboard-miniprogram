'use strict';

/**
 * Spy 模式领域逻辑（Phase 6 竖切）
 * 秘密存 secretsByUserId；公开态存 spyGame（不含他人密词）
 */

const {
  COMMAND_TYPES,
  ERR,
  fail,
  okResult
} = require('@cardboard/room-contracts');

const SPY_PHASE = {
  INTRO: 'intro',
  ASSIGN: 'assign',
  SPEAK: 'speak',
  VOTE: 'vote',
  RESULT: 'result',
  NEXT_ROUND: 'nextRound',
  SETTLE: 'settle'
};

const SPY_PAGE = {
  intro: 'spymodeindex',
  assign: 'spyassign',
  speak: 'spyspeak',
  vote: 'spyvote',
  result: 'spyresult',
  nextRound: 'spynextround',
  settle: 'spysettle'
};

const MIN_PLAYERS = 3;
const SPEAK_ROUND_MS = 5 * 60 * 1000;
const SPEAK_TURN_MS = 60 * 1000;
const VOTE_ROUND_MS = 2 * 60 * 1000;

const DEFAULT_WORD_PAIRS = [
  {
    id: 'pair_switch_click',
    civilianWord: '开关',
    civilianBlurb: '控件 0/1 状态直接对应物件状态。',
    spyWord: '单击',
    spyBlurb: '需完成按下再抬起才触发一次。'
  },
  {
    id: 'pair_drag_fling',
    civilianWord: '拖拽',
    civilianBlurb: '仅由位置驱动，实时跟随。',
    spyWord: '甩动',
    spyBlurb: '位置加释放速度驱动，释放后惯性滑行。'
  }
];

function pageForPhase(phase) {
  return SPY_PAGE[phase] || SPY_PAGE.intro;
}

function getDefaultSpyCount(playerCount) {
  const n = Number(playerCount) || 0;
  if (n < 3) return 0;
  if (n <= 6) return 1;
  return 2;
}

function shuffle(list, random) {
  const rnd = typeof random === 'function' ? random : Math.random;
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pickDefaultWordPair(random) {
  const rnd = typeof random === 'function' ? random : Math.random;
  const i = Math.floor(rnd() * DEFAULT_WORD_PAIRS.length);
  return DEFAULT_WORD_PAIRS[i] || DEFAULT_WORD_PAIRS[0];
}

function listPlayableMembers(room) {
  const seatMap = room.seatMap || {};
  const byUser = room.membersByUserId || {};
  return Object.keys(seatMap)
    .map((seat) => {
      const userId = seatMap[seat];
      const m = byUser[userId];
      if (!userId || !m) return null;
      return {
        userId,
        seatNo: Number(seat),
        playerIndex: Number(seat),
        nickName: m.nickName || `玩家${seat}`,
        avatarUrl: m.avatarUrl || null,
        avatarIndex: m.avatarIndex != null ? m.avatarIndex : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.seatNo - b.seatNo);
}

function emptyVoteStatus() {
  return {
    votedPlayerIndexes: [],
    tally: {},
    ballots: {}
  };
}

function beginSpeakPhase(spyGame, speakOrder, now) {
  const order = speakOrder || spyGame.speakOrder || [];
  return {
    ...spyGame,
    phase: SPY_PHASE.SPEAK,
    speakOrder: order,
    currentSpeakIndex: 0,
    speakRoundStartedAt: now,
    speakTurnStartedAt: now,
    voteStartedAt: 0,
    voteStatus: emptyVoteStatus(),
    lastResult: null,
    winnerSide: null,
    tieBreak: false
  };
}

function publicSpyGame(spyGame) {
  if (!spyGame) return null;
  const phase = spyGame.phase;
  const revealWords = phase === SPY_PHASE.SETTLE;
  return {
    phase,
    spyCount: spyGame.spyCount,
    round: spyGame.round,
    wordPairId: spyGame.wordPairId,
    civilianWord: revealWords ? spyGame.civilianWord : null,
    civilianBlurb: revealWords ? spyGame.civilianBlurb : null,
    spyWord: revealWords ? spyGame.spyWord : null,
    spyBlurb: revealWords ? spyGame.spyBlurb : null,
    players: (spyGame.players || []).map((p) => ({
      playerIndex: p.playerIndex,
      name: p.name,
      avatarUrl: p.avatarUrl || null,
      avatarIndex: p.avatarIndex != null ? p.avatarIndex : null,
      alive: p.alive !== false,
      leftRoom: p.leftRoom === true
    })),
    speakOrder: spyGame.speakOrder || [],
    currentSpeakIndex: spyGame.currentSpeakIndex || 0,
    speakRoundStartedAt: spyGame.speakRoundStartedAt || 0,
    speakTurnStartedAt: spyGame.speakTurnStartedAt || 0,
    voteStartedAt: spyGame.voteStartedAt || 0,
    speakRoundMs: spyGame.speakRoundMs || SPEAK_ROUND_MS,
    speakTurnMs: spyGame.speakTurnMs || SPEAK_TURN_MS,
    voteDeadlineMs: spyGame.voteDeadlineMs || VOTE_ROUND_MS,
    voteStatus: {
      votedCount: (spyGame.voteStatus && spyGame.voteStatus.votedPlayerIndexes
        ? spyGame.voteStatus.votedPlayerIndexes.length
        : 0)
    },
    lastResult: spyGame.lastResult || null,
    winnerSide: spyGame.winnerSide || null,
    tieBreak: spyGame.tieBreak === true
  };
}

/**
 * @param {object} ctx
 * @param {object} ctx.room
 * @param {object} ctx.envelope
 * @param {string} ctx.actorUserId
 * @param {number} ctx.ts
 * @param {() => object} [ctx.wordPairPicker]
 * @param {() => number} [ctx.random]
 */
function executeSpyCommand(ctx) {
  const {
    room,
    envelope,
    actorUserId,
    ts,
    wordPairPicker,
    random
  } = ctx;
  const { type, commandId, expectedRevision, payload } = envelope;

  if (type === COMMAND_TYPES.SPY_GET_MY_CARD) {
    const seatNo = Object.keys(room.seatMap || {}).find(
      (s) => String(room.seatMap[s]) === String(actorUserId)
    );
    const isHost = String(room.hostUserId) === String(actorUserId);
    if (!seatNo && !isHost) return fail(ERR.NOT_MEMBER);

    const secrets = room.secretsByUserId || {};
    const secret = secrets[actorUserId];
    if (!secret) return fail(ERR.NO_CARD);

    const speakOrder = (room.spyGame && room.spyGame.speakOrder) || [];
    const playerIndex = secret.playerIndex != null
      ? Number(secret.playerIndex)
      : Number(seatNo);
    const speakOrderRank = speakOrder.findIndex((idx) => Number(idx) === playerIndex) + 1;

    return okResult({
      commandId,
      appliedRevision: room.revision,
      changedDomains: [],
      room,
      effects: {
        readOnly: true,
        card: {
          playerIndex,
          role: secret.role,
          word: secret.word,
          blurb: secret.blurb,
          speakOrderRank: speakOrderRank > 0 ? speakOrderRank : null,
          speakOrderTotal: speakOrder.length
        },
        spyGame: publicSpyGame(room.spyGame)
      }
    });
  }

  if (type === COMMAND_TYPES.SPY_START_ASSIGN) {
    if (String(room.hostUserId) !== String(actorUserId)) {
      return fail(ERR.HOST_REQUIRED);
    }
    if (expectedRevision != null && Number(expectedRevision) !== Number(room.revision)) {
      return fail(ERR.REVISION_CONFLICT, null, { currentRevision: room.revision });
    }

    const players = listPlayableMembers(room);
    if (players.length < MIN_PLAYERS) {
      return fail(ERR.NOT_ENOUGH_PLAYERS, `至少需要 ${MIN_PLAYERS} 名玩家`);
    }

    const phase = room.spyGame && room.spyGame.phase;
    if (phase && phase !== SPY_PHASE.INTRO && phase !== SPY_PHASE.SETTLE) {
      return fail(ERR.GAME_IN_PROGRESS);
    }

    const pair = typeof wordPairPicker === 'function'
      ? wordPairPicker()
      : pickDefaultWordPair(random);
    if (!pair || !pair.civilianWord || !pair.spyWord) {
      return fail(ERR.NO_WORD_PAIR);
    }

    const spyCount = getDefaultSpyCount(players.length);
    const shuffled = shuffle(players, random);
    const secretsByUserId = {};
    const assignmentsBySeat = {};
    shuffled.forEach((m, index) => {
      const isSpy = index < spyCount;
      const row = {
        playerIndex: m.playerIndex,
        userId: m.userId,
        role: isSpy ? 'spy' : 'civilian',
        word: isSpy ? pair.spyWord : pair.civilianWord,
        blurb: isSpy ? (pair.spyBlurb || '') : (pair.civilianBlurb || ''),
        name: m.nickName
      };
      secretsByUserId[m.userId] = row;
      assignmentsBySeat[String(m.playerIndex)] = row;
    });

    const speakOrder = shuffle(players.map((m) => m.playerIndex), random);
    const playerSnaps = players.map((m) => ({
      playerIndex: m.playerIndex,
      name: m.nickName,
      avatarUrl: m.avatarUrl,
      avatarIndex: m.avatarIndex,
      alive: true
    }));

    let spyGame = {
      phase: SPY_PHASE.SPEAK,
      spyCount,
      round: 1,
      wordPairId: pair.id || null,
      civilianWord: pair.civilianWord,
      civilianBlurb: pair.civilianBlurb || '',
      spyWord: pair.spyWord,
      spyBlurb: pair.spyBlurb || '',
      players: playerSnaps,
      speakOrder,
      currentSpeakIndex: 0,
      speakRoundStartedAt: 0,
      speakTurnStartedAt: 0,
      voteStartedAt: 0,
      speakRoundMs: SPEAK_ROUND_MS,
      speakTurnMs: SPEAK_TURN_MS,
      voteDeadlineMs: VOTE_ROUND_MS,
      voteStatus: emptyVoteStatus(),
      lastResult: null,
      winnerSide: null,
      tieBreak: false
    };
    spyGame = beginSpeakPhase(spyGame, speakOrder, ts);

    const nextPage = pageForPhase(SPY_PHASE.SPEAK);
    const domainRevisions = {
      ...(room.domainRevisions || {}),
      session: ((room.domainRevisions && room.domainRevisions.session) || 0) + 1
    };
    const next = {
      ...room,
      selectedModeId: 'spy',
      currentPage: nextPage,
      brainstormProgressPage: nextPage,
      spyGame,
      // legacy 兼容字段：adapter 可双写；领域以 secretsByUserId 为准
      spyAssignments: assignmentsBySeat,
      secretsByUserId,
      workflow: {
        mode: 'SPY',
        step: 'SPY_SPEAK',
        roundNo: 1,
        turnId: `spy_r1_s${speakOrder[0] || 0}`,
        activeSeatNo: speakOrder[0] != null ? Number(speakOrder[0]) : null,
        deadlineAt: ts + SPEAK_TURN_MS
      },
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };

    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['session'],
      room: next,
      effects: {
        spyStarted: true,
        legacyPage: nextPage,
        spyGame: publicSpyGame(spyGame),
        secretsUpsert: true,
        // 兼容现网：一步完成分牌+进发言（蓝图 SPY_START_SPEAK 边暂并入）
        combinedStartSpeak: true,
        payloadNote: payload || null
      }
    });
  }

  return fail(ERR.INVALID_ARGUMENT, `未实现的 Spy 命令: ${type}`);
}

module.exports = {
  SPY_PHASE,
  SPY_PAGE,
  MIN_PLAYERS,
  executeSpyCommand,
  publicSpyGame,
  pageForPhase,
  getDefaultSpyCount,
  DEFAULT_WORD_PAIRS
};
