const cloud = require('wx-server-sdk');
const { pickRandomWordPair } = require('./spyWordPairs');
const {
  SPY_PHASE,
  SPEAK_ROUND_MS,
  SPEAK_TURN_MS,
  VOTE_ROUND_MS,
  MIN_PLAYERS,
  getDefaultSpyCount,
  resolveWinnerSide,
  pageForPhase
} = require('./spyGameState');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS = 'rooms';
const MEMBERS = 'roomMembers';

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function getOpenId() {
  const ctx = cloud.getWXContext();
  return ctx.FROM_OPENID || ctx.OPENID || '';
}

async function loadRoom(roomId) {
  const res = await db.collection(ROOMS).where({ roomId }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function loadMembers(roomId) {
  const res = await db.collection(MEMBERS).where({ roomId }).orderBy('playerIndex', 'asc').get();
  return res.data || [];
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
      .filter((p) => p && p.alive !== false)
      .map((p) => Number(p.playerIndex))
  );
}

function findSpeakIndex(order, players, from = 0) {
  const alive = getAliveIndexSet(players);
  const list = order || [];
  let i = Math.max(0, Number(from) || 0);
  while (i < list.length && !alive.has(Number(list[i]))) {
    i += 1;
  }
  return i;
}

/** 全员平等参玩（含原房间创建者） */
function getPlayerMembers(members) {
  return (members || []).filter((m) => m && m.userId);
}

function buildPlayerSnapshots(playerMembers, aliveMap) {
  return playerMembers.map((m) => {
    const idx = m.playerIndex;
    const alive = aliveMap && Object.prototype.hasOwnProperty.call(aliveMap, String(idx))
      ? !!aliveMap[String(idx)]
      : (aliveMap && Object.prototype.hasOwnProperty.call(aliveMap, idx)
        ? !!aliveMap[idx]
        : true);
    return {
      playerIndex: idx,
      name: m.nickName || `玩家${idx}`,
      avatarUrl: m.avatarUrl || null,
      avatarIndex: m.avatarIndex != null ? m.avatarIndex : null,
      alive
    };
  });
}

function emptyVoteStatus() {
  return {
    votedPlayerIndexes: [],
    abstainPlayerIndexes: [],
    tally: {},
    ballots: {}
  };
}

/**
 * 公开快照：不泄露他人词语/身份；投票中不公开票数与选票明细
 */
function publicSpyGame(spyGame, assignments) {
  if (!spyGame || typeof spyGame !== 'object') return null;
  const phase = spyGame.phase || SPY_PHASE.INTRO;
  const voteStatus = spyGame.voteStatus || {};
  const aliveCount = (spyGame.players || []).filter((p) => p && p.alive !== false).length;
  const votedCount = (voteStatus.votedPlayerIndexes || []).length;

  const base = {
    phase,
    spyCount: spyGame.spyCount || 0,
    round: spyGame.round || 1,
    players: Array.isArray(spyGame.players) ? spyGame.players : [],
    speakOrder: Array.isArray(spyGame.speakOrder) ? spyGame.speakOrder : [],
    currentSpeakIndex: spyGame.currentSpeakIndex != null ? spyGame.currentSpeakIndex : 0,
    speakRoundStartedAt: spyGame.speakRoundStartedAt || 0,
    speakTurnStartedAt: spyGame.speakTurnStartedAt || 0,
    voteStartedAt: spyGame.voteStartedAt || 0,
    speakRoundMs: spyGame.speakRoundMs || SPEAK_ROUND_MS,
    speakTurnMs: spyGame.speakTurnMs || SPEAK_TURN_MS,
    voteDeadlineMs: spyGame.voteDeadlineMs || VOTE_ROUND_MS,
    tieBreak: spyGame.tieBreak === true,
    voteStatus: {
      votedPlayerIndexes: Array.isArray(voteStatus.votedPlayerIndexes)
        ? voteStatus.votedPlayerIndexes
        : [],
      abstainPlayerIndexes: [],
      votedCount,
      totalVoters: aliveCount
    },
    lastResult: spyGame.lastResult || null,
    winnerSide: spyGame.winnerSide || null
  };

  // 仅结算阶段全员揭晓词与身份
  if (phase === SPY_PHASE.SETTLE) {
    base.civilianWord = spyGame.civilianWord || '';
    base.spyWord = spyGame.spyWord || '';
    const reveal = buildRevealList(spyGame, assignments || {});
    base.reveal = reveal;
    if (base.lastResult) {
      base.lastResult = { ...base.lastResult, reveal };
    }
  }

  // 结果/结算可展示匿名得票（不含谁投给谁）
  if (
    (phase === SPY_PHASE.RESULT || phase === SPY_PHASE.SETTLE || phase === SPY_PHASE.SPEAK)
    && spyGame.lastResult
    && spyGame.lastResult.tallies
  ) {
    // lastResult 已含 tallies
  }

  return base;
}

function buildRevealList(spyGame, assignments) {
  return (spyGame.players || []).map((p) => {
    const card = assignments[String(p.playerIndex)] || {};
    return {
      playerIndex: p.playerIndex,
      name: p.name || card.name || `玩家${p.playerIndex}`,
      role: card.role || '',
      word: card.word || '',
      alive: p.alive !== false
    };
  });
}

async function saveSpyRoom(room, patch) {
  const _ = db.command;
  const updateData = { updatedAt: db.serverDate() };
  Object.keys(patch || {}).forEach((key) => {
    const val = patch[key];
    if (val === null || val === undefined) {
      updateData[key] = _.remove();
    } else if (val && typeof val === 'object') {
      updateData[key] = _.set(val);
    } else {
      updateData[key] = val;
    }
  });
  await db.collection(ROOMS).doc(room._id).update({ data: updateData });
}

function assertMember(members, userId) {
  return (members || []).find((m) => m && String(m.userId) === String(userId)) || null;
}

function beginSpeakPhase(spyGame, speakOrder) {
  const now = Date.now();
  const order = speakOrder || spyGame.speakOrder || [];
  const first = findSpeakIndex(order, spyGame.players, 0);
  spyGame.phase = SPY_PHASE.SPEAK;
  spyGame.speakOrder = order;
  spyGame.currentSpeakIndex = first;
  spyGame.speakRoundStartedAt = now;
  spyGame.speakTurnStartedAt = first < order.length ? now : 0;
  spyGame.speakTurnMs = spyGame.speakTurnMs || SPEAK_TURN_MS;
  spyGame.voteStartedAt = 0;
  spyGame.voteStatus = emptyVoteStatus();
  return spyGame;
}

function beginVotePhase(spyGame) {
  spyGame.phase = SPY_PHASE.VOTE;
  spyGame.voteStartedAt = Date.now();
  spyGame.voteStatus = emptyVoteStatus();
  spyGame.speakTurnStartedAt = 0;
  return spyGame;
}

/** 开始游戏：随机分词 + 直接进入发言（全员平等） */
async function actionStartAssign(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };

  const members = await loadMembers(roomId);
  const me = assertMember(members, userId);
  if (!me) return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };

  const players = getPlayerMembers(members);
  if (players.length < MIN_PLAYERS) {
    return {
      ok: false,
      errCode: 'NOT_ENOUGH_PLAYERS',
      errMsg: `至少需要 ${MIN_PLAYERS} 名玩家`
    };
  }

  if (room.spyGame && room.spyGame.phase && room.spyGame.phase !== SPY_PHASE.INTRO
    && room.spyGame.phase !== SPY_PHASE.SETTLE) {
    return { ok: false, errCode: 'GAME_IN_PROGRESS', errMsg: '本局已在进行中' };
  }

  const spyCount = getDefaultSpyCount(players.length);
  const pair = pickRandomWordPair();
  if (!pair) {
    return { ok: false, errCode: 'NO_WORD_PAIR', errMsg: '词库为空' };
  }

  const shuffled = shuffle(players);
  const assignments = {};
  shuffled.forEach((m, index) => {
    const isSpy = index < spyCount;
    assignments[String(m.playerIndex)] = {
      playerIndex: m.playerIndex,
      userId: m.userId,
      role: isSpy ? 'spy' : 'civilian',
      word: isSpy ? pair.spyWord : pair.civilianWord,
      blurb: isSpy ? pair.spyBlurb : pair.civilianBlurb,
      name: m.nickName || `玩家${m.playerIndex}`
    };
  });

  const speakOrder = shuffle(players.map((m) => m.playerIndex));
  const playerSnaps = buildPlayerSnapshots(players, null);

  let spyGame = {
    phase: SPY_PHASE.SPEAK,
    spyCount,
    round: 1,
    wordPairId: pair.id,
    civilianWord: pair.civilianWord,
    civilianBlurb: pair.civilianBlurb,
    spyWord: pair.spyWord,
    spyBlurb: pair.spyBlurb,
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
  spyGame = beginSpeakPhase(spyGame, speakOrder);

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.SPEAK),
    brainstormProgressPage: pageForPhase(SPY_PHASE.SPEAK),
    spyGame,
    spyAssignments: assignments,
    selectedModeId: 'spy'
  });

  return {
    ok: true,
    spyGame: publicSpyGame(spyGame, assignments),
    currentPage: pageForPhase(SPY_PHASE.SPEAK)
  };
}

async function actionGetMyCard(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  const members = await loadMembers(roomId);
  const me = assertMember(members, userId);
  if (!me) return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };

  const assignments = room.spyAssignments || {};
  const card = assignments[String(me.playerIndex)];
  if (!card) {
    return { ok: false, errCode: 'NO_CARD', errMsg: '尚未分配身份' };
  }

  const speakOrder = (room.spyGame && room.spyGame.speakOrder) || [];
  const speakOrderRank = speakOrder.findIndex((idx) => samePlayerIndex(idx, me.playerIndex)) + 1;

  return {
    ok: true,
    card: {
      playerIndex: me.playerIndex,
      // 仅本人可见：下发 role 供自己确认，但客户端不得展示给他人
      role: card.role,
      word: card.word,
      blurb: card.blurb,
      speakOrderRank: speakOrderRank > 0 ? speakOrderRank : null,
      speakOrderTotal: speakOrder.length
    }
  };
}

/** 仅当前发言者可结束自己的发言；全员结束后自动进入投票 */
async function actionAdvanceSpeak(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };

  let spyGame = { ...(room.spyGame || {}) };
  if (spyGame.phase !== SPY_PHASE.SPEAK) {
    return { ok: false, errCode: 'NOT_IN_SPEAK', errMsg: '当前不在发言阶段' };
  }

  const order = spyGame.speakOrder || [];
  const curIdx = spyGame.currentSpeakIndex != null ? Number(spyGame.currentSpeakIndex) : 0;
  const currentPlayerIndex = curIdx < order.length ? order[curIdx] : null;

  const members = await loadMembers(roomId);
  const me = assertMember(members, userId);
  if (!me) return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };

  const isCurrentSpeaker = currentPlayerIndex != null
    && samePlayerIndex(me.playerIndex, currentPlayerIndex);
  if (!isCurrentSpeaker) {
    return { ok: false, errCode: 'NOT_ALLOWED', errMsg: '仅当前发言者可结束发言' };
  }

  const next = findSpeakIndex(order, spyGame.players, curIdx + 1);
  if (next >= order.length) {
    // 全员发言结束 → 自动进入匿名投票
    spyGame.currentSpeakIndex = order.length;
    spyGame = beginVotePhase(spyGame);
    spyGame.tieBreak = false;
    await saveSpyRoom(room, {
      currentPage: pageForPhase(SPY_PHASE.VOTE),
      brainstormProgressPage: pageForPhase(SPY_PHASE.VOTE),
      spyGame
    });
    return {
      ok: true,
      finished: true,
      autoVote: true,
      spyGame: publicSpyGame(spyGame, room.spyAssignments),
      currentPage: pageForPhase(SPY_PHASE.VOTE)
    };
  }

  spyGame.currentSpeakIndex = next;
  spyGame.speakTurnStartedAt = Date.now();
  spyGame.speakTurnMs = spyGame.speakTurnMs || SPEAK_TURN_MS;
  await saveSpyRoom(room, { spyGame });
  return {
    ok: true,
    finished: false,
    spyGame: publicSpyGame(spyGame, room.spyAssignments)
  };
}

async function resolveAndSaveVote(room, spyGame) {
  const assignments = room.spyAssignments || {};
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

  // 平票：并列玩家重新陈述后再次匿名投票
  if (maxVotes > 0 && topIndexes.length > 1) {
    const tiedOrder = shuffle(topIndexes.slice());
    spyGame.lastResult = {
      eliminatedIndex: null,
      eliminatedRole: null,
      eliminatedName: '',
      maxVotes,
      tied: true,
      tiedIndexes: topIndexes,
      tallies: publicTallies,
      winnerSide: null
    };
    spyGame.tieBreak = true;
    spyGame.winnerSide = null;
    spyGame = beginSpeakPhase(spyGame, tiedOrder);
    await saveSpyRoom(room, {
      currentPage: pageForPhase(SPY_PHASE.SPEAK),
      brainstormProgressPage: pageForPhase(SPY_PHASE.SPEAK),
      spyGame
    });
    return {
      ok: true,
      tied: true,
      settled: false,
      spyGame: publicSpyGame(spyGame, assignments),
      currentPage: pageForPhase(SPY_PHASE.SPEAK)
    };
  }

  let eliminatedIndex = null;
  let eliminatedRole = null;
  let eliminatedName = '';
  if (maxVotes > 0 && topIndexes.length === 1) {
    eliminatedIndex = topIndexes[0];
    const card = assignments[String(eliminatedIndex)];
    eliminatedRole = card ? card.role : null;
    const snap = (spyGame.players || []).find((p) => samePlayerIndex(p.playerIndex, eliminatedIndex));
    eliminatedName = (snap && snap.name) || (card && card.name) || `玩家${eliminatedIndex}`;
    spyGame.players = (spyGame.players || []).map((p) => {
      if (samePlayerIndex(p.playerIndex, eliminatedIndex)) {
        return { ...p, alive: false };
      }
      return p;
    });
  }

  const rolePlayers = (spyGame.players || []).map((p) => {
    const card = assignments[String(p.playerIndex)] || {};
    return { role: card.role || 'civilian', alive: p.alive !== false };
  });
  const winnerSide = resolveWinnerSide(rolePlayers);

  spyGame.lastResult = {
    eliminatedIndex,
    eliminatedRole,
    eliminatedName,
    maxVotes,
    tied: false,
    tallies: publicTallies,
    winnerSide
  };
  spyGame.winnerSide = winnerSide;
  spyGame.tieBreak = false;

  if (winnerSide) {
    spyGame.phase = SPY_PHASE.SETTLE;
    const reveal = buildRevealList(spyGame, assignments);
    spyGame.lastResult = { ...spyGame.lastResult, reveal };
    await saveSpyRoom(room, {
      currentPage: pageForPhase(SPY_PHASE.SETTLE),
      brainstormProgressPage: pageForPhase(SPY_PHASE.SETTLE),
      spyGame
    });
    return {
      ok: true,
      settled: true,
      spyGame: publicSpyGame(spyGame, assignments),
      currentPage: pageForPhase(SPY_PHASE.SETTLE)
    };
  }

  spyGame.phase = SPY_PHASE.RESULT;
  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.RESULT),
    brainstormProgressPage: pageForPhase(SPY_PHASE.RESULT),
    spyGame
  });
  return {
    ok: true,
    settled: false,
    spyGame: publicSpyGame(spyGame, assignments),
    currentPage: pageForPhase(SPY_PHASE.RESULT)
  };
}

async function actionSubmitVote(roomId, userId, event) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };

  const spyGame = { ...(room.spyGame || {}) };
  if (spyGame.phase !== SPY_PHASE.VOTE) {
    return { ok: false, errCode: 'NOT_IN_VOTE', errMsg: '当前不在投票阶段' };
  }

  const members = await loadMembers(roomId);
  const me = assertMember(members, userId);
  if (!me) return { ok: false, errCode: 'NOT_PLAYER', errMsg: '非参与者' };

  const mySnap = (spyGame.players || []).find((p) => samePlayerIndex(p.playerIndex, me.playerIndex));
  if (!mySnap || mySnap.alive === false) {
    return { ok: false, errCode: 'ELIMINATED', errMsg: '已出局无法投票' };
  }

  const voteStatus = {
    votedPlayerIndexes: [...((spyGame.voteStatus && spyGame.voteStatus.votedPlayerIndexes) || [])],
    abstainPlayerIndexes: [],
    tally: { ...((spyGame.voteStatus && spyGame.voteStatus.tally) || {}) },
    ballots: { ...((spyGame.voteStatus && spyGame.voteStatus.ballots) || {}) }
  };

  if (indexIncludes(voteStatus.votedPlayerIndexes, me.playerIndex)) {
    return { ok: false, errCode: 'ALREADY_VOTED', errMsg: '已投票，不可修改' };
  }

  const targetPlayerIndex = Number(event && event.targetPlayerIndex);
  if (!targetPlayerIndex || samePlayerIndex(targetPlayerIndex, me.playerIndex)) {
    return { ok: false, errCode: 'INVALID_TARGET', errMsg: '请选择一名其他玩家' };
  }
  const target = (spyGame.players || []).find((p) => samePlayerIndex(p.playerIndex, targetPlayerIndex));
  if (!target || target.alive === false) {
    return { ok: false, errCode: 'INVALID_TARGET', errMsg: '目标不可投票' };
  }

  const key = String(targetPlayerIndex);
  voteStatus.tally[key] = (Number(voteStatus.tally[key]) || 0) + 1;
  voteStatus.ballots[String(me.playerIndex)] = {
    abstain: false,
    targetPlayerIndex
  };
  voteStatus.votedPlayerIndexes.push(me.playerIndex);
  spyGame.voteStatus = voteStatus;

  const aliveVoters = (spyGame.players || []).filter((p) => p && p.alive !== false);
  const allVoted = aliveVoters.every((p) => indexIncludes(voteStatus.votedPlayerIndexes, p.playerIndex));

  if (allVoted) {
    return resolveAndSaveVote(room, spyGame);
  }

  await saveSpyRoom(room, { spyGame });
  return { ok: true, spyGame: publicSpyGame(spyGame, room.spyAssignments) };
}

/** 任意玩家可推进到下一轮发言（幂等） */
async function actionNextRound(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };

  const members = await loadMembers(roomId);
  if (!assertMember(members, userId)) {
    return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };
  }

  let spyGame = { ...(room.spyGame || {}) };
  if (spyGame.phase === SPY_PHASE.SPEAK && !spyGame.tieBreak) {
    return { ok: true, spyGame: publicSpyGame(spyGame, room.spyAssignments), already: true };
  }
  if (spyGame.phase !== SPY_PHASE.RESULT && spyGame.phase !== SPY_PHASE.NEXT_ROUND) {
    return { ok: false, errCode: 'NOT_READY', errMsg: '当前无法进入下一轮' };
  }

  const alive = (spyGame.players || [])
    .filter((p) => p.alive !== false)
    .map((p) => Number(p.playerIndex));
  if (alive.length < 2) {
    return { ok: false, errCode: 'NOT_ENOUGH_ALIVE', errMsg: '存活人数不足' };
  }

  let speakOrder = shuffle(alive);
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
  spyGame = beginSpeakPhase(spyGame, speakOrder);

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.SPEAK),
    brainstormProgressPage: pageForPhase(SPY_PHASE.SPEAK),
    spyGame
  });

  return {
    ok: true,
    spyGame: publicSpyGame(spyGame, room.spyAssignments),
    currentPage: pageForPhase(SPY_PHASE.SPEAK)
  };
}

async function actionRestart(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  const members = await loadMembers(roomId);
  if (!assertMember(members, userId)) {
    return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };
  }

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.INTRO),
    brainstormProgressPage: pageForPhase(SPY_PHASE.INTRO),
    spyGame: null,
    spyAssignments: null
  });

  return { ok: true, currentPage: pageForPhase(SPY_PHASE.INTRO) };
}

exports.main = async (event) => {
  const action = event && event.action;
  const roomId = event && event.roomId;
  if (!action || !roomId) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'action 与 roomId 必填' };
  }

  const userId = getOpenId();
  if (!userId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    switch (action) {
      case 'startAssign':
      case 'startGame':
        return await actionStartAssign(roomId, userId);
      case 'getMyCard':
        return await actionGetMyCard(roomId, userId);
      case 'advanceSpeak':
      case 'finishSpeak':
        return await actionAdvanceSpeak(roomId, userId);
      case 'submitVote':
        return await actionSubmitVote(roomId, userId, event);
      case 'nextRound':
      case 'continueRound':
        return await actionNextRound(roomId, userId);
      case 'restart':
        return await actionRestart(roomId, userId);
      // 兼容旧客户端：已废弃的主持人动作
      case 'hostOverview':
        return { ok: false, errCode: 'DEPRECATED', errMsg: '已取消主持人视角' };
      case 'startSpeak':
      case 'startVote':
      case 'confirmResult':
      case 'enterNextRoundPage':
        return { ok: false, errCode: 'DEPRECATED', errMsg: '流程已改为全员自动推进' };
      default:
        return { ok: false, errCode: 'UNKNOWN_ACTION', errMsg: `未知 action: ${action}` };
    }
  } catch (e) {
    console.error('spyGameAction error', action, e);
    return {
      ok: false,
      errCode: e.errCode || 'SPY_ACTION_ERROR',
      errMsg: e.errMsg || e.message || '操作失败'
    };
  }
};

exports.publicSpyGame = publicSpyGame;
