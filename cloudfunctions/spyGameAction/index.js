const cloud = require('wx-server-sdk');
const { pickRandomWordPair } = require('./spyWordPairs');
const {
  SPY_PHASE,
  SPEAK_ROUND_MS,
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

function assertHost(room, userId) {
  return !!(room && room.creatorId && String(room.creatorId) === String(userId));
}

function getPlayerMembers(members) {
  return (members || []).filter((m) => m && m.role !== 'GOD');
}

function buildPlayerSnapshots(playerMembers, aliveMap) {
  return playerMembers.map((m) => {
    const idx = m.playerIndex;
    const alive = aliveMap && Object.prototype.hasOwnProperty.call(aliveMap, idx)
      ? !!aliveMap[idx]
      : true;
    return {
      playerIndex: idx,
      name: m.nickName || `玩家${idx}`,
      avatarUrl: m.avatarUrl || null,
      avatarIndex: m.avatarIndex != null ? m.avatarIndex : null,
      alive
    };
  });
}

function publicSpyGame(spyGame, isHost, assignments) {
  if (!spyGame || typeof spyGame !== 'object') return null;
  const base = {
    phase: spyGame.phase || SPY_PHASE.INTRO,
    spyCount: spyGame.spyCount || 0,
    round: spyGame.round || 1,
    players: Array.isArray(spyGame.players) ? spyGame.players : [],
    speakOrder: Array.isArray(spyGame.speakOrder) ? spyGame.speakOrder : [],
    currentSpeakIndex: spyGame.currentSpeakIndex != null ? spyGame.currentSpeakIndex : 0,
    speakRoundStartedAt: spyGame.speakRoundStartedAt || 0,
    voteStartedAt: spyGame.voteStartedAt || 0,
    speakRoundMs: spyGame.speakRoundMs || SPEAK_ROUND_MS,
    voteDeadlineMs: spyGame.voteDeadlineMs || VOTE_ROUND_MS,
    voteStatus: {
      votedPlayerIndexes: Array.isArray(spyGame.voteStatus && spyGame.voteStatus.votedPlayerIndexes)
        ? spyGame.voteStatus.votedPlayerIndexes
        : [],
      abstainPlayerIndexes: Array.isArray(spyGame.voteStatus && spyGame.voteStatus.abstainPlayerIndexes)
        ? spyGame.voteStatus.abstainPlayerIndexes
        : []
    },
    lastResult: spyGame.lastResult || null,
    winnerSide: spyGame.winnerSide || null
  };

  if (isHost) {
    base.civilianWord = spyGame.civilianWord || '';
    base.spyWord = spyGame.spyWord || '';
    base.civilianBlurb = spyGame.civilianBlurb || '';
    base.spyBlurb = spyGame.spyBlurb || '';
    base.voteStatus.tally = (spyGame.voteStatus && spyGame.voteStatus.tally) || {};
    base.voteStatus.ballots = (spyGame.voteStatus && spyGame.voteStatus.ballots) || {};
  }

  // 结算阶段全员揭晓
  if (spyGame.phase === SPY_PHASE.SETTLE) {
    base.civilianWord = spyGame.civilianWord || '';
    base.spyWord = spyGame.spyWord || '';
    const reveal = buildRevealList(spyGame, assignments || {});
    base.reveal = reveal;
    if (base.lastResult) {
      base.lastResult = { ...base.lastResult, reveal };
    }
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
  const updateData = {
    updatedAt: db.serverDate()
  };
  Object.keys(patch || {}).forEach((key) => {
    const val = patch[key];
    // null 字段上直接写带数字键的对象会报 Cannot create field 'N'
    // 统一用 set/remove 整字段替换
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

async function actionStartAssign(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可开始分配' };
  }

  const members = await loadMembers(roomId);
  const players = getPlayerMembers(members);
  if (players.length < MIN_PLAYERS) {
    return {
      ok: false,
      errCode: 'NOT_ENOUGH_PLAYERS',
      errMsg: `至少需要 ${MIN_PLAYERS} 名参与者`
    };
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

  const spyGame = {
    phase: SPY_PHASE.ASSIGN,
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
    voteStartedAt: 0,
    speakRoundMs: SPEAK_ROUND_MS,
    voteDeadlineMs: VOTE_ROUND_MS,
    voteStatus: {
      votedPlayerIndexes: [],
      abstainPlayerIndexes: [],
      tally: {},
      ballots: {}
    },
    lastResult: null,
    winnerSide: null
  };

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.ASSIGN),
    brainstormProgressPage: pageForPhase(SPY_PHASE.ASSIGN),
    spyGame,
    spyAssignments: assignments,
    selectedModeId: 'spy'
  });

  return {
    ok: true,
    spyGame: publicSpyGame(spyGame, true),
    currentPage: pageForPhase(SPY_PHASE.ASSIGN)
  };
}

async function actionGetMyCard(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  const members = await loadMembers(roomId);
  const me = members.find((m) => m.userId === userId);
  if (!me) return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };
  if (me.role === 'GOD' || assertHost(room, userId)) {
    return { ok: false, errCode: 'HOST_NO_CARD', errMsg: '主持人不参与发牌' };
  }

  const assignments = room.spyAssignments || {};
  const card = assignments[String(me.playerIndex)];
  if (!card) {
    return { ok: false, errCode: 'NO_CARD', errMsg: '尚未分配身份' };
  }

  const speakOrder = (room.spyGame && room.spyGame.speakOrder) || [];
  const speakOrderRank = speakOrder.indexOf(me.playerIndex) + 1;

  return {
    ok: true,
    card: {
      playerIndex: me.playerIndex,
      role: card.role,
      word: card.word,
      blurb: card.blurb,
      speakOrderRank: speakOrderRank > 0 ? speakOrderRank : null,
      speakOrderTotal: speakOrder.length
    }
  };
}

async function actionHostOverview(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可查看' };
  }

  const assignments = room.spyAssignments || {};
  const spyGame = room.spyGame || {};
  const speakOrder = spyGame.speakOrder || [];
  const list = Object.keys(assignments)
    .map((key) => {
      const item = assignments[key];
      const rank = speakOrder.indexOf(item.playerIndex) + 1;
      return {
        playerIndex: item.playerIndex,
        name: item.name,
        role: item.role,
        word: item.word,
        blurb: item.blurb,
        alive: (() => {
          const p = (spyGame.players || []).find((x) => x.playerIndex === item.playerIndex);
          return p ? p.alive !== false : true;
        })(),
        speakOrderRank: rank > 0 ? rank : null
      };
    })
    .sort((a, b) => (a.speakOrderRank || 99) - (b.speakOrderRank || 99));

  return {
    ok: true,
    civilianWord: spyGame.civilianWord || '',
    spyWord: spyGame.spyWord || '',
    civilianBlurb: spyGame.civilianBlurb || '',
    spyBlurb: spyGame.spyBlurb || '',
    players: list,
    speakOrder,
    spyGame: publicSpyGame(spyGame, true)
  };
}

async function actionStartSpeak(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可操作' };
  }
  const spyGame = { ...(room.spyGame || {}) };
  spyGame.phase = SPY_PHASE.SPEAK;
  spyGame.speakRoundStartedAt = Date.now();
  spyGame.currentSpeakIndex = 0;
  spyGame.voteStartedAt = 0;
  spyGame.voteStatus = {
    votedPlayerIndexes: [],
    abstainPlayerIndexes: [],
    tally: {},
    ballots: {}
  };

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.SPEAK),
    brainstormProgressPage: pageForPhase(SPY_PHASE.SPEAK),
    spyGame
  });

  return { ok: true, spyGame: publicSpyGame(spyGame, true) };
}

async function actionAdvanceSpeak(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可操作' };
  }
  const spyGame = { ...(room.spyGame || {}) };
  const order = spyGame.speakOrder || [];
  const aliveSet = new Set(
    (spyGame.players || []).filter((p) => p.alive !== false).map((p) => p.playerIndex)
  );
  let next = (spyGame.currentSpeakIndex || 0) + 1;
  while (next < order.length && !aliveSet.has(order[next])) {
    next += 1;
  }
  if (next >= order.length) {
    return { ok: true, finished: true, spyGame: publicSpyGame(spyGame, true) };
  }
  spyGame.currentSpeakIndex = next;
  await saveSpyRoom(room, { spyGame });
  return { ok: true, finished: false, spyGame: publicSpyGame(spyGame, true) };
}

async function actionStartVote(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可开启投票' };
  }
  const spyGame = { ...(room.spyGame || {}) };
  spyGame.phase = SPY_PHASE.VOTE;
  spyGame.voteStartedAt = Date.now();
  spyGame.voteStatus = {
    votedPlayerIndexes: [],
    abstainPlayerIndexes: [],
    tally: {},
    ballots: {}
  };

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.VOTE),
    brainstormProgressPage: pageForPhase(SPY_PHASE.VOTE),
    spyGame
  });

  return { ok: true, spyGame: publicSpyGame(spyGame, true) };
}

async function actionSubmitVote(roomId, userId, event) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (assertHost(room, userId)) {
    return { ok: false, errCode: 'HOST_NO_VOTE', errMsg: '主持人不参与投票' };
  }

  const spyGame = { ...(room.spyGame || {}) };
  if (spyGame.phase !== SPY_PHASE.VOTE) {
    return { ok: false, errCode: 'NOT_IN_VOTE', errMsg: '当前不在投票阶段' };
  }

  const members = await loadMembers(roomId);
  const me = members.find((m) => m.userId === userId);
  if (!me || me.role === 'GOD') {
    return { ok: false, errCode: 'NOT_PLAYER', errMsg: '非参与者' };
  }

  const mySnap = (spyGame.players || []).find((p) => p.playerIndex === me.playerIndex);
  if (!mySnap || mySnap.alive === false) {
    return { ok: false, errCode: 'ELIMINATED', errMsg: '已出局无法投票' };
  }

  const voteStatus = {
    votedPlayerIndexes: [...((spyGame.voteStatus && spyGame.voteStatus.votedPlayerIndexes) || [])],
    abstainPlayerIndexes: [...((spyGame.voteStatus && spyGame.voteStatus.abstainPlayerIndexes) || [])],
    tally: { ...((spyGame.voteStatus && spyGame.voteStatus.tally) || {}) },
    ballots: { ...((spyGame.voteStatus && spyGame.voteStatus.ballots) || {}) }
  };

  if (voteStatus.votedPlayerIndexes.includes(me.playerIndex)) {
    return { ok: false, errCode: 'ALREADY_VOTED', errMsg: '已投票' };
  }

  const abstain = event.abstain === true;
  let targetPlayerIndex = event.targetPlayerIndex;

  if (abstain) {
    voteStatus.abstainPlayerIndexes.push(me.playerIndex);
    voteStatus.ballots[String(me.playerIndex)] = { abstain: true };
  } else {
    targetPlayerIndex = Number(targetPlayerIndex);
    if (!targetPlayerIndex || targetPlayerIndex === me.playerIndex) {
      return { ok: false, errCode: 'INVALID_TARGET', errMsg: '请选择有效投票目标' };
    }
    const target = (spyGame.players || []).find((p) => p.playerIndex === targetPlayerIndex);
    if (!target || target.alive === false) {
      return { ok: false, errCode: 'INVALID_TARGET', errMsg: '目标不可投票' };
    }
    const key = String(targetPlayerIndex);
    voteStatus.tally[key] = (voteStatus.tally[key] || 0) + 1;
    voteStatus.ballots[String(me.playerIndex)] = {
      abstain: false,
      targetPlayerIndex
    };
  }

  voteStatus.votedPlayerIndexes.push(me.playerIndex);
  spyGame.voteStatus = voteStatus;

  await saveSpyRoom(room, { spyGame });
  return { ok: true, spyGame: publicSpyGame(spyGame, false) };
}

async function actionConfirmResult(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可确认结果' };
  }

  const spyGame = { ...(room.spyGame || {}) };
  if (spyGame.phase !== SPY_PHASE.VOTE && spyGame.phase !== SPY_PHASE.RESULT) {
    return { ok: false, errCode: 'NOT_IN_VOTE', errMsg: '当前无法确认结果' };
  }

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

  let eliminatedIndex = null;
  let eliminatedRole = null;
  let eliminatedName = '';
  if (maxVotes > 0 && topIndexes.length === 1) {
    eliminatedIndex = topIndexes[0];
    const card = assignments[String(eliminatedIndex)];
    eliminatedRole = card ? card.role : null;
    const snap = (spyGame.players || []).find((p) => p.playerIndex === eliminatedIndex);
    eliminatedName = (snap && snap.name) || (card && card.name) || `玩家${eliminatedIndex}`;
    spyGame.players = (spyGame.players || []).map((p) => {
      if (p.playerIndex === eliminatedIndex) {
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
    tied: maxVotes > 0 && topIndexes.length > 1,
    tallies: tally,
    winnerSide
  };
  spyGame.winnerSide = winnerSide;

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
      spyGame: publicSpyGame(spyGame, true, assignments),
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
    spyGame: publicSpyGame(spyGame, true, assignments),
    currentPage: pageForPhase(SPY_PHASE.RESULT)
  };
}

async function actionNextRound(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可操作' };
  }

  const spyGame = { ...(room.spyGame || {}) };
  const alive = (spyGame.players || []).filter((p) => p.alive !== false).map((p) => p.playerIndex);
  if (alive.length < 2) {
    return { ok: false, errCode: 'NOT_ENOUGH_ALIVE', errMsg: '存活人数不足' };
  }

  let speakOrder = shuffle(alive);
  const eliminated = spyGame.lastResult && spyGame.lastResult.eliminatedIndex;
  if (eliminated != null) {
    const oldOrder = spyGame.speakOrder || [];
    const elimPos = oldOrder.indexOf(eliminated);
    if (elimPos >= 0) {
      const rotated = [];
      for (let i = 1; i <= oldOrder.length; i += 1) {
        const idx = oldOrder[(elimPos + i) % oldOrder.length];
        if (alive.includes(idx)) rotated.push(idx);
      }
      if (rotated.length) speakOrder = rotated;
    }
  }

  spyGame.speakOrder = speakOrder;
  spyGame.currentSpeakIndex = 0;
  spyGame.round = (spyGame.round || 1) + 1;
  spyGame.phase = SPY_PHASE.SPEAK;
  spyGame.speakRoundStartedAt = Date.now();
  spyGame.voteStartedAt = 0;
  spyGame.voteStatus = {
    votedPlayerIndexes: [],
    abstainPlayerIndexes: [],
    tally: {},
    ballots: {}
  };

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.SPEAK),
    brainstormProgressPage: pageForPhase(SPY_PHASE.SPEAK),
    spyGame
  });

  return { ok: true, spyGame: publicSpyGame(spyGame, true) };
}

async function actionRestart(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可操作' };
  }

  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.INTRO),
    brainstormProgressPage: pageForPhase(SPY_PHASE.INTRO),
    spyGame: null,
    spyAssignments: null
  });

  return { ok: true, currentPage: pageForPhase(SPY_PHASE.INTRO) };
}

async function actionEnterNextRoundPage(roomId, userId) {
  const room = await loadRoom(roomId);
  if (!room) return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  if (!assertHost(room, userId)) {
    return { ok: false, errCode: 'NOT_HOST', errMsg: '仅主持人可操作' };
  }
  const spyGame = { ...(room.spyGame || {}) };
  spyGame.phase = SPY_PHASE.NEXT_ROUND;
  await saveSpyRoom(room, {
    currentPage: pageForPhase(SPY_PHASE.NEXT_ROUND),
    brainstormProgressPage: pageForPhase(SPY_PHASE.NEXT_ROUND),
    spyGame
  });
  return { ok: true, spyGame: publicSpyGame(spyGame, true) };
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
        return await actionStartAssign(roomId, userId);
      case 'getMyCard':
        return await actionGetMyCard(roomId, userId);
      case 'hostOverview':
        return await actionHostOverview(roomId, userId);
      case 'startSpeak':
        return await actionStartSpeak(roomId, userId);
      case 'advanceSpeak':
        return await actionAdvanceSpeak(roomId, userId);
      case 'startVote':
        return await actionStartVote(roomId, userId);
      case 'submitVote':
        return await actionSubmitVote(roomId, userId, event);
      case 'confirmResult':
        return await actionConfirmResult(roomId, userId);
      case 'enterNextRoundPage':
        return await actionEnterNextRoundPage(roomId, userId);
      case 'nextRound':
        return await actionNextRound(roomId, userId);
      case 'restart':
        return await actionRestart(roomId, userId);
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
