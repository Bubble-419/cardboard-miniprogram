'use strict';

/**
 * Spy 模式领域逻辑（Phase 6）
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

function samePlayerIndex(a, b) {
  if (a == null || b == null) return false;
  return Number(a) === Number(b);
}

function indexIncludes(list, index) {
  if (!Array.isArray(list) || index == null) return false;
  const n = Number(index);
  return list.some((item) => Number(item) === n);
}

function getAliveIndexSet(players) {
  return new Set(
    (players || [])
      .filter((p) => p && p.alive !== false && p.leftRoom !== true)
      .map((p) => Number(p.playerIndex))
  );
}

function findSpeakIndex(order, players, from) {
  const alive = getAliveIndexSet(players);
  const list = order || [];
  let i = Math.max(0, Number(from) || 0);
  while (i < list.length && !alive.has(Number(list[i]))) {
    i += 1;
  }
  return i;
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
    abstainPlayerIndexes: [],
    tally: {},
    ballots: {}
  };
}

function assignmentsMap(room) {
  if (room.spyAssignments && typeof room.spyAssignments === 'object') {
    return room.spyAssignments;
  }
  const secrets = room.secretsByUserId || {};
  const out = {};
  Object.keys(secrets).forEach((userId) => {
    const row = secrets[userId];
    if (!row) return;
    const seat = row.playerIndex != null ? String(row.playerIndex) : null;
    if (seat) out[seat] = { ...row, userId };
  });
  return out;
}

function resolveWinnerSide(players) {
  const alive = (players || []).filter((p) => p && p.alive !== false);
  const spies = alive.filter((p) => p.role === 'spy');
  const civilians = alive.filter((p) => p.role === 'civilian');
  if (spies.length === 0) return 'civilian';
  if (spies.length >= civilians.length) return 'spy';
  return null;
}

function buildRevealList(spyGame, assignments) {
  return (spyGame.players || [])
    .filter((p) => p && p.leftRoom !== true)
    .map((p) => {
      const card = assignments[String(p.playerIndex)] || {};
      return {
        playerIndex: p.playerIndex,
        name: p.name || card.name || `玩家${p.playerIndex}`,
        role: card.role || null,
        word: card.word || null,
        alive: p.alive !== false
      };
    });
}

function beginSpeakPhase(spyGame, speakOrder, now) {
  const order = speakOrder || spyGame.speakOrder || [];
  const first = findSpeakIndex(order, spyGame.players, 0);
  return {
    ...spyGame,
    phase: SPY_PHASE.SPEAK,
    speakOrder: order,
    currentSpeakIndex: first,
    speakRoundStartedAt: now,
    speakTurnStartedAt: first < order.length ? now : 0,
    speakTurnMs: spyGame.speakTurnMs || SPEAK_TURN_MS,
    voteStartedAt: 0,
    voteStatus: emptyVoteStatus()
  };
}

function beginVotePhase(spyGame, now) {
  return {
    ...spyGame,
    phase: SPY_PHASE.VOTE,
    voteStartedAt: now,
    voteStatus: emptyVoteStatus(),
    speakTurnStartedAt: 0
  };
}

function publicSpyGame(spyGame, assignments) {
  if (!spyGame) return null;
  const phase = spyGame.phase;
  const voteStatus = spyGame.voteStatus || {};
  const aliveCount = (spyGame.players || [])
    .filter((p) => p && p.alive !== false && p.leftRoom !== true).length;
  const votedCount = (voteStatus.votedPlayerIndexes || []).length;
  const revealWords = phase === SPY_PHASE.SETTLE;
  const base = {
    phase,
    spyCount: spyGame.spyCount,
    round: spyGame.round,
    wordPairId: spyGame.wordPairId || null,
    civilianWord: revealWords ? spyGame.civilianWord : null,
    civilianBlurb: revealWords ? spyGame.civilianBlurb : null,
    spyWord: revealWords ? spyGame.spyWord : null,
    spyBlurb: revealWords ? spyGame.spyBlurb : null,
    players: (spyGame.players || [])
      .filter((p) => p && p.leftRoom !== true)
      .map((p) => ({
        playerIndex: p.playerIndex,
        name: p.name,
        avatarUrl: p.avatarUrl || null,
        avatarIndex: p.avatarIndex != null ? p.avatarIndex : null,
        alive: p.alive !== false,
        leftRoom: p.leftRoom === true
      })),
    speakOrder: spyGame.speakOrder || [],
    currentSpeakIndex: spyGame.currentSpeakIndex != null ? spyGame.currentSpeakIndex : 0,
    speakRoundStartedAt: spyGame.speakRoundStartedAt || 0,
    speakTurnStartedAt: spyGame.speakTurnStartedAt || 0,
    voteStartedAt: spyGame.voteStartedAt || 0,
    speakRoundMs: spyGame.speakRoundMs || SPEAK_ROUND_MS,
    speakTurnMs: spyGame.speakTurnMs || SPEAK_TURN_MS,
    voteDeadlineMs: spyGame.voteDeadlineMs || VOTE_ROUND_MS,
    voteStatus: {
      votedPlayerIndexes: Array.isArray(voteStatus.votedPlayerIndexes)
        ? voteStatus.votedPlayerIndexes
        : [],
      abstainPlayerIndexes: [],
      votedCount,
      totalVoters: aliveCount
    },
    lastResult: spyGame.lastResult || null,
    winnerSide: spyGame.winnerSide || null,
    tieBreak: spyGame.tieBreak === true
  };
  if (revealWords) {
    const reveal = buildRevealList(spyGame, assignments || {});
    base.reveal = reveal;
    if (base.lastResult) {
      base.lastResult = { ...base.lastResult, reveal };
    }
  }
  return base;
}

function assertRevision(room, expectedRevision) {
  if (expectedRevision != null && Number(expectedRevision) !== Number(room.revision)) {
    return fail(ERR.REVISION_CONFLICT, null, { currentRevision: room.revision });
  }
  return null;
}

function actorSeatNo(room, actorUserId) {
  const seat = Object.keys(room.seatMap || {}).find(
    (s) => String(room.seatMap[s]) === String(actorUserId)
  );
  return seat != null ? Number(seat) : null;
}

function patchSpyRoom(room, spyGame, page, ts, extras) {
  const domainRevisions = {
    ...(room.domainRevisions || {}),
    session: ((room.domainRevisions && room.domainRevisions.session) || 0) + 1
  };
  const order = spyGame.speakOrder || [];
  const cur = spyGame.currentSpeakIndex != null ? Number(spyGame.currentSpeakIndex) : 0;
  const activeSeatNo = cur < order.length ? Number(order[cur]) : null;
  return {
    ...room,
    ...(extras || {}),
    selectedModeId: room.selectedModeId || 'spy',
    currentPage: page,
    brainstormProgressPage: page,
    spyGame,
    domainRevisions,
    revision: room.revision + 1,
    updatedAt: ts,
    workflow: {
      mode: 'SPY',
      step: `SPY_${String(spyGame.phase || 'INTRO').toUpperCase()}`,
      roundNo: spyGame.round || 1,
      turnId: `spy_r${spyGame.round || 1}_s${activeSeatNo != null ? activeSeatNo : 0}`,
      activeSeatNo,
      deadlineAt: spyGame.phase === SPY_PHASE.SPEAK && spyGame.speakTurnStartedAt
        ? spyGame.speakTurnStartedAt + (spyGame.speakTurnMs || SPEAK_TURN_MS)
        : null
    }
  };
}

function okSpy(commandId, next, effects) {
  const assignments = next.spyAssignments || assignmentsMap(next);
  return okResult({
    commandId,
    appliedRevision: next.revision,
    changedDomains: ['session'],
    room: next,
    effects: {
      legacyPage: next.currentPage,
      spyGame: publicSpyGame(next.spyGame, assignments),
      ...(effects || {})
    }
  });
}

function resolveVote(room, spyGame, ts, random) {
  const assignments = assignmentsMap(room);
  const tally = (spyGame.voteStatus && spyGame.voteStatus.tally) || {};
  let maxVotes = 0;
  let topIndexes = [];
  Object.keys(tally).forEach((key) => {
    const count = Number(tally[key]) || 0;
    const idx = Number(key);
    if (count > maxVotes) {
      maxVotes = count;
      topIndexes = [idx];
    } else if (count === maxVotes && count > 0) {
      topIndexes.push(idx);
    }
  });
  const publicTallies = { ...tally };

  if (maxVotes > 0 && topIndexes.length > 1) {
    const tiedOrder = shuffle(topIndexes.slice(), random);
    let nextGame = {
      ...spyGame,
      lastResult: {
        eliminatedIndex: null,
        eliminatedRole: null,
        eliminatedName: '',
        maxVotes,
        tied: true,
        tiedIndexes: topIndexes,
        tallies: publicTallies,
        winnerSide: null
      },
      tieBreak: true,
      winnerSide: null
    };
    nextGame = beginSpeakPhase(nextGame, tiedOrder, ts);
    const page = pageForPhase(SPY_PHASE.SPEAK);
    const next = patchSpyRoom(room, nextGame, page, ts);
    return okSpy(null, next, { tied: true, settled: false });
  }

  let eliminatedIndex = null;
  let eliminatedRole = null;
  let eliminatedName = '';
  let nextGame = { ...spyGame };
  if (maxVotes > 0 && topIndexes.length === 1) {
    eliminatedIndex = topIndexes[0];
    const card = assignments[String(eliminatedIndex)];
    eliminatedRole = card ? card.role : null;
    const snap = (nextGame.players || []).find((p) => samePlayerIndex(p.playerIndex, eliminatedIndex));
    eliminatedName = (snap && snap.name) || (card && card.name) || `玩家${eliminatedIndex}`;
    nextGame.players = (nextGame.players || []).map((p) => (
      samePlayerIndex(p.playerIndex, eliminatedIndex) ? { ...p, alive: false } : p
    ));
  }

  const rolePlayers = (nextGame.players || []).map((p) => {
    const card = assignments[String(p.playerIndex)] || {};
    return { role: card.role || 'civilian', alive: p.alive !== false };
  });
  const winnerSide = resolveWinnerSide(rolePlayers);
  nextGame.lastResult = {
    eliminatedIndex,
    eliminatedRole,
    eliminatedName,
    maxVotes,
    tied: false,
    tallies: publicTallies,
    winnerSide
  };
  nextGame.winnerSide = winnerSide;
  nextGame.tieBreak = false;

  if (winnerSide) {
    nextGame.phase = SPY_PHASE.SETTLE;
    const reveal = buildRevealList(nextGame, assignments);
    nextGame.lastResult = { ...nextGame.lastResult, reveal };
    const page = pageForPhase(SPY_PHASE.SETTLE);
    const next = patchSpyRoom(room, nextGame, page, ts);
    return okSpy(null, next, { settled: true });
  }

  nextGame.phase = SPY_PHASE.RESULT;
  const page = pageForPhase(SPY_PHASE.RESULT);
  const next = patchSpyRoom(room, nextGame, page, ts);
  return okSpy(null, next, { settled: false });
}

/**
 * @param {object} ctx
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
  const seatNo = actorSeatNo(room, actorUserId);
  const isHost = String(room.hostUserId) === String(actorUserId);

  if (type === COMMAND_TYPES.SPY_GET_MY_CARD) {
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
        spyGame: publicSpyGame(room.spyGame, assignmentsMap(room))
      }
    });
  }

  if (type === COMMAND_TYPES.SPY_START_ASSIGN) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    const revErr = assertRevision(room, expectedRevision);
    if (revErr) return revErr;

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
    const page = pageForPhase(SPY_PHASE.SPEAK);
    const next = patchSpyRoom(room, spyGame, page, ts, {
      spyAssignments: assignmentsBySeat,
      secretsByUserId,
      selectedModeId: 'spy'
    });
    const result = okSpy(commandId, next, {
      spyStarted: true,
      secretsUpsert: true,
      combinedStartSpeak: true,
      payloadNote: payload || null
    });
    result.commandId = commandId;
    return result;
  }

  if (type === COMMAND_TYPES.SPY_START_SPEAK) {
    // 现网已合并进 START_ASSIGN；保留幂等 / 房主强制开票
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    const revErr = assertRevision(room, expectedRevision);
    if (revErr) return revErr;
    if (room.spyGame && room.spyGame.phase === SPY_PHASE.SPEAK && payload && payload.forceVote) {
      let spyGame = { ...room.spyGame };
      const order = spyGame.speakOrder || [];
      spyGame.currentSpeakIndex = order.length;
      spyGame = beginVotePhase(spyGame, ts);
      spyGame.tieBreak = false;
      const page = pageForPhase(SPY_PHASE.VOTE);
      const next = patchSpyRoom(room, spyGame, page, ts);
      const result = okSpy(commandId, next, { autoVote: true, finished: true });
      result.commandId = commandId;
      return result;
    }
    if (room.spyGame && room.spyGame.phase === SPY_PHASE.SPEAK) {
      return okResult({
        commandId,
        appliedRevision: room.revision,
        changedDomains: [],
        room,
        effects: {
          readOnly: true,
          already: true,
          spyGame: publicSpyGame(room.spyGame, assignmentsMap(room)),
          legacyPage: pageForPhase(SPY_PHASE.SPEAK)
        }
      });
    }
    return fail(ERR.INVALID_TRANSITION, '请先分牌开局');
  }

  if (type === COMMAND_TYPES.SPY_ADVANCE_SPEAKER) {
    const revErr = assertRevision(room, expectedRevision);
    if (revErr) return revErr;
    let spyGame = room.spyGame ? { ...room.spyGame } : null;
    if (!spyGame || spyGame.phase !== SPY_PHASE.SPEAK) {
      return fail(ERR.INVALID_TRANSITION, '当前不在发言阶段');
    }
    if (!seatNo && !isHost) return fail(ERR.NOT_MEMBER);

    const order = spyGame.speakOrder || [];
    const curIdx = spyGame.currentSpeakIndex != null ? Number(spyGame.currentSpeakIndex) : 0;
    const currentPlayerIndex = curIdx < order.length ? order[curIdx] : null;
    const isCurrentSpeaker = currentPlayerIndex != null && samePlayerIndex(seatNo, currentPlayerIndex);
    // 房主可强制开票（payload.forceVote），否则仅当前发言者
    if (payload && payload.forceVote) {
      if (!isHost) return fail(ERR.HOST_REQUIRED);
      spyGame.currentSpeakIndex = order.length;
      spyGame = beginVotePhase(spyGame, ts);
      spyGame.tieBreak = false;
      const page = pageForPhase(SPY_PHASE.VOTE);
      const next = patchSpyRoom(room, spyGame, page, ts);
      const result = okSpy(commandId, next, { finished: true, autoVote: true });
      result.commandId = commandId;
      return result;
    }
    if (!isCurrentSpeaker) {
      return fail(ERR.INVALID_TRANSITION, '仅当前发言者可结束发言');
    }

    const nextIdx = findSpeakIndex(order, spyGame.players, curIdx + 1);
    if (nextIdx >= order.length) {
      spyGame.currentSpeakIndex = order.length;
      spyGame = beginVotePhase(spyGame, ts);
      spyGame.tieBreak = false;
      const page = pageForPhase(SPY_PHASE.VOTE);
      const next = patchSpyRoom(room, spyGame, page, ts);
      const result = okSpy(commandId, next, { finished: true, autoVote: true });
      result.commandId = commandId;
      return result;
    }

    spyGame.currentSpeakIndex = nextIdx;
    spyGame.speakTurnStartedAt = ts;
    spyGame.speakTurnMs = spyGame.speakTurnMs || SPEAK_TURN_MS;
    const next = patchSpyRoom(room, spyGame, pageForPhase(SPY_PHASE.SPEAK), ts);
    const result = okSpy(commandId, next, { finished: false });
    result.commandId = commandId;
    return result;
  }

  if (type === COMMAND_TYPES.SPY_SUBMIT_VOTE) {
    if (!seatNo) return fail(ERR.NOT_MEMBER);
    let spyGame = room.spyGame ? { ...room.spyGame } : null;
    if (!spyGame || spyGame.phase !== SPY_PHASE.VOTE) {
      return fail(ERR.INVALID_TRANSITION, '当前不在投票阶段');
    }
    const mySnap = (spyGame.players || []).find((p) => samePlayerIndex(p.playerIndex, seatNo));
    if (!mySnap || mySnap.alive === false) {
      return fail(ERR.INVALID_TRANSITION, '已出局无法投票');
    }

    const voteStatus = {
      votedPlayerIndexes: [...((spyGame.voteStatus && spyGame.voteStatus.votedPlayerIndexes) || [])],
      abstainPlayerIndexes: [],
      tally: { ...((spyGame.voteStatus && spyGame.voteStatus.tally) || {}) },
      ballots: { ...((spyGame.voteStatus && spyGame.voteStatus.ballots) || {}) }
    };
    if (indexIncludes(voteStatus.votedPlayerIndexes, seatNo)) {
      return fail(ERR.ALREADY_VOTED, '已投票，不可修改');
    }

    const targetPlayerIndex = Number(payload && payload.targetPlayerIndex);
    if (!targetPlayerIndex || samePlayerIndex(targetPlayerIndex, seatNo)) {
      return fail(ERR.INVALID_ARGUMENT, '请选择一名其他玩家');
    }
    const target = (spyGame.players || []).find((p) => samePlayerIndex(p.playerIndex, targetPlayerIndex));
    if (!target || target.alive === false) {
      return fail(ERR.INVALID_ARGUMENT, '目标不可投票');
    }

    const key = String(targetPlayerIndex);
    voteStatus.tally[key] = (Number(voteStatus.tally[key]) || 0) + 1;
    voteStatus.ballots[String(seatNo)] = { abstain: false, targetPlayerIndex };
    voteStatus.votedPlayerIndexes.push(seatNo);
    spyGame.voteStatus = voteStatus;

    const aliveVoters = (spyGame.players || [])
      .filter((p) => p && p.alive !== false && p.leftRoom !== true);
    const allVoted = aliveVoters.every((p) => indexIncludes(voteStatus.votedPlayerIndexes, p.playerIndex));

    if (allVoted) {
      const resolved = resolveVote(room, spyGame, ts, random);
      resolved.commandId = commandId;
      return resolved;
    }

    const next = patchSpyRoom(room, spyGame, pageForPhase(SPY_PHASE.VOTE), ts);
    const result = okSpy(commandId, next, {});
    result.commandId = commandId;
    return result;
  }

  if (type === COMMAND_TYPES.SPY_CONFIRM_RESULT) {
    // 现网已废弃主持人确认；幂等返回当前态
    if (!seatNo && !isHost) return fail(ERR.NOT_MEMBER);
    return okResult({
      commandId,
      appliedRevision: room.revision,
      changedDomains: [],
      room,
      effects: {
        readOnly: true,
        deprecated: true,
        spyGame: publicSpyGame(room.spyGame, assignmentsMap(room)),
        legacyPage: room.currentPage || pageForPhase(room.spyGame && room.spyGame.phase)
      }
    });
  }

  if (type === COMMAND_TYPES.SPY_NEXT_ROUND || type === COMMAND_TYPES.SPY_CONTINUE) {
    if (!seatNo && !isHost) return fail(ERR.NOT_MEMBER);
    const revErr = assertRevision(room, expectedRevision);
    if (revErr) return revErr;

    let spyGame = room.spyGame ? { ...room.spyGame } : null;
    if (!spyGame) return fail(ERR.INVALID_TRANSITION, '当前无法进入下一轮');
    if (spyGame.phase === SPY_PHASE.SPEAK && !spyGame.tieBreak) {
      return okResult({
        commandId,
        appliedRevision: room.revision,
        changedDomains: [],
        room,
        effects: {
          readOnly: true,
          already: true,
          spyGame: publicSpyGame(spyGame, assignmentsMap(room))
        }
      });
    }
    if (spyGame.phase !== SPY_PHASE.RESULT && spyGame.phase !== SPY_PHASE.NEXT_ROUND) {
      return fail(ERR.INVALID_TRANSITION, '当前无法进入下一轮');
    }

    const alive = (spyGame.players || [])
      .filter((p) => p.alive !== false && p.leftRoom !== true)
      .map((p) => Number(p.playerIndex));
    if (alive.length < 2) {
      return fail(ERR.INVALID_TRANSITION, '存活人数不足');
    }

    let speakOrder = shuffle(alive, random);
    const eliminated = spyGame.lastResult && spyGame.lastResult.eliminatedIndex;
    if (eliminated != null) {
      const oldOrder = spyGame.speakOrder || [];
      const elimPos = oldOrder.findIndex((idx) => samePlayerIndex(idx, eliminated));
      if (elimPos >= 0) {
        const aliveSet = new Set(alive);
        const rotated = [];
        for (let i = 1; i <= oldOrder.length; i += 1) {
          const idx = Number(oldOrder[(elimPos + i) % oldOrder.length]);
          if (aliveSet.has(idx)) rotated.push(idx);
        }
        if (rotated.length) speakOrder = rotated;
      }
    }

    spyGame.round = (spyGame.round || 1) + 1;
    spyGame.tieBreak = false;
    spyGame.winnerSide = null;
    spyGame = beginSpeakPhase(spyGame, speakOrder, ts);
    const page = pageForPhase(SPY_PHASE.SPEAK);
    const next = patchSpyRoom(room, spyGame, page, ts);
    const result = okSpy(commandId, next, {});
    result.commandId = commandId;
    return result;
  }

  if (type === COMMAND_TYPES.SPY_RESTART) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    const revErr = assertRevision(room, expectedRevision);
    if (revErr) return revErr;
    const page = pageForPhase(SPY_PHASE.INTRO);
    const domainRevisions = {
      ...(room.domainRevisions || {}),
      session: ((room.domainRevisions && room.domainRevisions.session) || 0) + 1
    };
    const next = {
      ...room,
      currentPage: page,
      brainstormProgressPage: page,
      spyGame: null,
      spyAssignments: null,
      secretsByUserId: null,
      workflow: null,
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
        legacyPage: page,
        spyGame: null,
        secretsClear: true,
        restarted: true
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
  resolveWinnerSide,
  DEFAULT_WORD_PAIRS
};
