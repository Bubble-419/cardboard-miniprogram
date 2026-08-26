const cloud = require('wx-server-sdk');
const { resolveActiveClosingVotes } = require('./closingVoteState');
const { resolveScoreProgress } = require('./scoreProgress');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';
const ROOM_SCORES_COLLECTION = 'roomScores';

/** 未刷新超过该时长视为离线（仅标记，不删除成员、不释放席位） */
const PRESENCE_TIMEOUT_MS = 90 * 1000;

const NON_RESUMABLE_PROGRESS_PAGES = ['closingend', 'closingstatement', 'brainstormmode'];

function isNonResumableProgressPage(page) {
  return NON_RESUMABLE_PROGRESS_PAGES.includes((page || '').toLowerCase());
}

function sameUserId(a, b) {
  return a != null && b != null && String(a) === String(b);
}

function collectCallerUserIds(wxContext) {
  const ids = [];
  const fromOpenid = wxContext && wxContext.FROM_OPENID;
  const openid = wxContext && wxContext.OPENID;
  if (fromOpenid) ids.push(String(fromOpenid));
  if (openid && ids.indexOf(String(openid)) === -1) ids.push(String(openid));
  return ids;
}

function findMemberByCaller(members, callerIds) {
  const ids = callerIds || [];
  return (members || []).find((m) => m && ids.some((id) => sameUserId(m.userId, id))) || null;
}

/** 谁是卧底公开快照：不泄露他人词语/身份；投票中不公开票数 */
function buildPublicSpyGame(spyGame, isHost, assignments) {
  if (!spyGame || typeof spyGame !== 'object') return null;
  const voteStatus = spyGame.voteStatus || {};
  const phase = spyGame.phase || 'intro';
  const aliveCount = (Array.isArray(spyGame.players) ? spyGame.players : [])
    .filter((p) => p && p.alive !== false && p.leftRoom !== true).length;
  const votedCount = Array.isArray(voteStatus.votedPlayerIndexes)
    ? voteStatus.votedPlayerIndexes.length
    : 0;
  const base = {
    phase,
    spyCount: spyGame.spyCount || 0,
    round: spyGame.round || 1,
    players: (Array.isArray(spyGame.players) ? spyGame.players : [])
      .filter((p) => p && p.leftRoom !== true),
    speakOrder: Array.isArray(spyGame.speakOrder) ? spyGame.speakOrder : [],
    currentSpeakIndex: spyGame.currentSpeakIndex != null ? spyGame.currentSpeakIndex : 0,
    speakRoundStartedAt: spyGame.speakRoundStartedAt || 0,
    speakTurnStartedAt: spyGame.speakTurnStartedAt || 0,
    voteStartedAt: spyGame.voteStartedAt || 0,
    speakRoundMs: spyGame.speakRoundMs || 300000,
    speakTurnMs: spyGame.speakTurnMs || 60000,
    voteDeadlineMs: spyGame.voteDeadlineMs || 120000,
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
  // 仅结算阶段全员揭晓
  if (phase === 'settle') {
    base.civilianWord = spyGame.civilianWord || '';
    base.spyWord = spyGame.spyWord || '';
    const assignMap = assignments || {};
    base.reveal = (spyGame.players || []).map((p) => {
      const card = assignMap[String(p.playerIndex)] || {};
      return {
        playerIndex: p.playerIndex,
        name: p.name || card.name || `玩家${p.playerIndex}`,
        role: card.role || '',
        word: card.word || '',
        alive: p.alive !== false && p.leftRoom !== true
      };
    });
  }
  return base;
}

function countValidScores(scoreRows, actingUserId) {
  const seen = new Set();
  let scoredCount = 0;
  for (const row of scoreRows || []) {
    if (!row || !row.userId) continue;
    if (actingUserId && row.userId === actingUserId) continue;
    if (seen.has(row.userId)) continue;
    seen.add(row.userId);
    scoredCount += 1;
  }
  return scoredCount;
}

async function loadScoreProgress(room, members, currentUserId) {
  const actingPlayerIndex = room.currentPlayerIndex != null
    ? parseInt(room.currentPlayerIndex, 10)
    : 1;
  const currentRound = room.currentRound != null ? room.currentRound : 1;

  let scoreRows = [];
  try {
    const scoresRes = await db
      .collection(ROOM_SCORES_COLLECTION)
      .where({ roomId: room.roomId, currentPlayerIndex: actingPlayerIndex, round: currentRound })
      .get();
    scoreRows = scoresRes.data || [];
  } catch (e) {
    console.warn('loadScoreProgress roomScores', e);
  }

  return resolveScoreProgress({
    progress: room.progress,
    scoreRows,
    scoresByKey: room.scoresByKey,
    members,
    currentRound,
    actingPlayerIndex,
    myUserId: currentUserId
  });
}

function isMemberOnline(member, now, hostUserId) {
  if (!member) return false;
  if (hostUserId && String(member.userId) === String(hostUserId)) return true;
  if (member.lastSeenAt == null || member.lastSeenAt === '') return true;
  return now - Number(member.lastSeenAt) <= PRESENCE_TIMEOUT_MS;
}

/**
 * Presence 只读投影辅助：不写库。
 * V1 兼容路径仍可选择刷新本人心跳；V2（protocolVersion===2）禁止查询写副作用。
 */
async function applyPresenceView(room, currentUserId, members, options) {
  const now = Date.now();
  const list = Array.isArray(members) ? members.slice() : [];
  const lastEvent = room.lastEvent || null;
  const allowWrite = !(options && options.noSideEffects);

  if (allowWrite) {
    const myMember = list.find((m) => m && sameUserId(m.userId, currentUserId)) || null;
    if (myMember && myMember._id) {
      try {
        await db.collection(ROOM_MEMBERS_COLLECTION).doc(myMember._id).update({
          data: { lastSeenAt: now }
        });
        myMember.lastSeenAt = now;
      } catch (e) {
        console.warn('touch lastSeenAt failed', e);
      }
    }
  }

  return { members: list, room, lastEvent };
}

function isLocalTempAvatar(url) {
  if (typeof url !== 'string' || !url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith('wxfile://') ||
    lower.startsWith('file://') ||
    lower.startsWith('http://tmp/') ||
    lower.startsWith('https://tmp/') ||
    lower.indexOf('://tmp/') !== -1
  );
}

async function resolveCloudAvatarUrls(members) {
  return (members || []).map((m) => {
    if (!m) return m;
    // 本机临时路径无法跨设备加载，返回前清掉，客户端回退 avatarIndex
    if (isLocalTempAvatar(m.avatarUrl)) {
      return { ...m, avatarUrl: null };
    }
    if (typeof m.avatarUrl === 'string' && m.avatarUrl.startsWith('cloud://')) {
      return { ...m, avatarFileID: m.avatarUrl };
    }
    return m;
  });
}

/**
 * 供 addPlayer 页使用：返回房间小程序码 fileID 与成员列表（含 isMe）
 */
exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  const wxContext = cloud.getWXContext();
  // 跨账号共享时 OPENID 为资源方，调用方用户需用 FROM_OPENID
  const callerIds = collectCallerUserIds(wxContext);
  const currentUserId = callerIds[0] || '';

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return {
        ok: false,
        errCode: 'ROOM_NOT_FOUND',
        errMsg: '房间不存在',
        roomDissolved: true,
        event: 'room_dissolved',
        roomId
      };
    }

    let room = roomRes.data[0];
    if (room.status === 'DISSOLVED' || room.lifecycle === 'DISSOLVED') {
      return {
        ok: false,
        errCode: 'ROOM_DISSOLVED',
        errMsg: '房间已解散',
        roomDissolved: true,
        event: 'room_dissolved',
        roomId
      };
    }

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .orderBy('playerIndex', 'asc')
      .get();

    let rawMembers = membersRes.data || [];
    let myMember = findMemberByCaller(rawMembers, callerIds);
    let isHost = !!(room.creatorId && callerIds.some((id) => sameUserId(room.creatorId, id)));

    if (!isHost && !myMember) {
      return {
        ok: false,
        errCode: 'NOT_IN_ROOM',
        errMsg: '您已不在该房间'
      };
    }

    // V2 房间：查询无写副作用（心跳走 roomPresence）；V1 仍刷新本人 lastSeenAt
    const isV2 = Number(room.protocolVersion) === 2 || Number(room.schemaVersion) === 2;
    const presenceUserId = (myMember && myMember.userId) || currentUserId;
    const presence = await applyPresenceView(room, presenceUserId, rawMembers, {
      noSideEffects: isV2 || event.noSideEffects === true
    });
    room = presence.room || room;
    rawMembers = presence.members || rawMembers;
    myMember = findMemberByCaller(rawMembers, callerIds);
    const lastEvent = presence.lastEvent || room.lastEvent || null;
    const presenceNow = Date.now();

    isHost = !!(room.creatorId && callerIds.some((id) => sameUserId(room.creatorId, id)));
    if (!isHost && !myMember) {
      return {
        ok: false,
        errCode: 'NOT_IN_ROOM',
        errMsg: '您已不在该房间'
      };
    }

    const selectedModeId = room.selectedModeId != null ? room.selectedModeId : null;
    const hasSelectedMode = selectedModeId != null && selectedModeId !== '';
    const brainstormSessionEnded = room.brainstormSessionEnded === true;
    const brainstormSessionSeq = room.brainstormSessionSeq != null ? room.brainstormSessionSeq : 0;
    let currentPage = room.currentPage || 'addPlayer';
    // 房主回到房间大厅时 currentPage 可能为 addPlayer，用 brainstormProgressPage 恢复脑暴进度
    if (
      hasSelectedMode &&
      !brainstormSessionEnded &&
      (String(currentPage).toLowerCase() === 'addplayer' || !room.currentPage) &&
      room.brainstormProgressPage &&
      !isNonResumableProgressPage(room.brainstormProgressPage)
    ) {
      currentPage = room.brainstormProgressPage;
    }

    const pageLower = (currentPage || '').toLowerCase();
    // 仅在收尾表态页返回本会话选票；其它页一律空，避免串入上一轮残留
    const activeClosing = pageLower === 'closingstatement'
      ? resolveActiveClosingVotes(room)
      : {
        votes: {},
        seq: 0,
        sessionId: 0
      };
    const includeFullPartnerContent = event && event.full === true;
    const scoreProgress = await loadScoreProgress(
      room,
      rawMembers,
      (myMember && myMember.userId) || currentUserId
    );

    const roomState = {
      selectedModeId: selectedModeId || null,
      selectedDesignProblem: room.selectedDesignProblem || null,
      editingProblemId: room.editingProblemId || '',
      currentPage,
      brainstormSessionEnded,
      brainstormSessionSeq,
      currentRound: room.currentRound != null ? room.currentRound : 1,
      currentPlayerIndex: room.currentPlayerIndex != null ? room.currentPlayerIndex : 1,
      currentPlayerName: room.currentPlayerName || '玩家1',
      passCount: room.currentPassCount != null ? room.currentPassCount : null,
      memberCount: rawMembers.length,
      partnerGamePhase: room.partnerGamePhase || 'play',
      partnerMasterMode: room.partnerMasterMode === true,
      partnerClosingStep: room.partnerClosingStep || 'rune',
      closingQuestionPlayers: Array.isArray(room.closingQuestionPlayers)
        ? room.closingQuestionPlayers
        : [],
      closingVotes: activeClosing.votes || {},
      closingVoteSeq: activeClosing.seq || 0,
      closingVoteSessionId: activeClosing.sessionId || 0,
      partnerRoundStartedAt: room.partnerRoundStartedAt != null ? room.partnerRoundStartedAt : null,
      // 当前行动玩家本轮首次倒计时起点（卡片循环不更新），用于全员同步头像框
      partnerTurnStartedAt: room.partnerTurnStartedAt != null ? room.partnerTurnStartedAt : null,
      spyGame: buildPublicSpyGame(room.spyGame, isHost, room.spyAssignments),
      // 评分：只计「非出牌且仍在房」成员；myScore 用于同步「已打分/未打分」
      scoredCount: scoreProgress.scoredCount,
      totalRequired: scoreProgress.totalRequired,
      myScore: scoreProgress.myScore,
      progress: {
        scoredCount: scoreProgress.scoredCount,
        requiredScoreCount: scoreProgress.totalRequired,
        turnId: scoreProgress.turnId
      },
      revision: room.revision != null ? room.revision : null,
      protocolVersion: room.protocolVersion != null ? room.protocolVersion : 1
    };

    // 默认不返回大体积脑暴内容，避免各页轮询拖垮测试性能；gamepage 传 full:true
    if (includeFullPartnerContent) {
      roomState.partnerRoundSummaries = Array.isArray(room.partnerRoundSummaries)
        ? room.partnerRoundSummaries
        : [];
      roomState.partnerCurrentRoundContent = room.partnerCurrentRoundContent || {
        playHistory: [],
        discussionNotes: [],
        playImages: [],
        discussionImages: [],
        images: [],
        voiceLines: [],
        turnRecords: [],
        aiSummary: { status: 'pending' }
      };
      roomState.partnerExpressMessages = Array.isArray(room.partnerExpressMessages)
        ? room.partnerExpressMessages.slice(-40)
        : [];
      const closingCreative = room.partnerClosingCreativePoints;
      roomState.partnerClosingCreativePoints = closingCreative && typeof closingCreative === 'object'
        ? {
          blocks: Array.isArray(closingCreative.blocks) ? closingCreative.blocks : [],
          texts: Array.isArray(closingCreative.texts) ? closingCreative.texts : [],
          images: Array.isArray(closingCreative.images) ? closingCreative.images : []
        }
        : { blocks: [], texts: [], images: [] };
    }

    if (event && event.includeTurnScores === true) {
      try {
        const scoresRes = await db.collection(ROOM_SCORES_COLLECTION).where({ roomId }).get();
        const buckets = {};
        (scoresRes.data || []).forEach((row) => {
          if (!row || row.score == null) return;
          const n = Number(row.score);
          if (!Number.isFinite(n)) return;
          const roundNo = row.round != null ? Number(row.round) : 1;
          const playerNo = Number(row.currentPlayerIndex);
          if (!Number.isFinite(roundNo) || !Number.isFinite(playerNo)) return;
          const key = `r${roundNo}_p${playerNo}`;
          if (!buckets[key]) buckets[key] = { sum: 0, count: 0 };
          buckets[key].sum += n;
          buckets[key].count += 1;
        });
        const turnAvgScores = {};
        Object.keys(buckets).forEach((key) => {
          const b = buckets[key];
          if (b.count > 0) {
            turnAvgScores[key] = Math.round((b.sum / b.count) * 10) / 10;
          }
        });
        roomState.turnAvgScores = turnAvgScores;
        // 回顾态：把均分回填到纪要卡 / turnRecords，修复旧归档缺 avgScore 的情况
        if (Array.isArray(roomState.partnerRoundSummaries)) {
          roomState.partnerRoundSummaries = roomState.partnerRoundSummaries.map((item) => {
            if (!item || typeof item !== 'object') return item;
            const key = `r${Number(item.round)}_p${Number(item.playerIndex)}`;
            const fromScores = turnAvgScores[key];
            const turns = Array.isArray(item.turnRecords)
              ? item.turnRecords.map((t) => {
                if (!t || typeof t !== 'object') return t;
                if (t.avgScore != null) return t;
                const tKey = `r${Number(item.round)}_p${Number(t.playerIndex)}`;
                if (turnAvgScores[tKey] == null) return t;
                return { ...t, avgScore: turnAvgScores[tKey] };
              })
              : [];
            let avgScore = item.avgScore != null ? Number(item.avgScore) : null;
            if (avgScore == null) {
              const matched = turns.find(
                (t) => t && Number(t.playerIndex) === Number(item.playerIndex) && t.avgScore != null
              ) || turns.find((t) => t && t.avgScore != null);
              if (matched) avgScore = Number(matched.avgScore);
              else if (fromScores != null) avgScore = fromScores;
            }
            return {
              ...item,
              turnRecords: turns.length ? turns : item.turnRecords,
              avgScore
            };
          });
        }
      } catch (scoreErr) {
        console.warn('getAddPlayerData turnAvgScores', scoreErr);
        roomState.turnAvgScores = {};
      }
    }

    const members = rawMembers.map((m) => {
      const out = {
        playerIndex: m.playerIndex,
        nickName: m.nickName || `玩家${m.playerIndex}`,
        avatarColor: m.avatarColor || '#5EC159',
        avatarUrl: m.avatarUrl || null,
        isMe: callerIds.some((id) => sameUserId(m.userId, id)),
        userId: m.userId || null,
        role: m.role || 'PLAYER',
        online: isMemberOnline(m, presenceNow, room.creatorId),
        lastSeenAt: m.lastSeenAt != null ? m.lastSeenAt : null
      };
      // 始终带回 avatarIndex，便于 avatarUrl 不可用时客户端回退随机头像
      if (m.avatarIndex != null) out.avatarIndex = m.avatarIndex;
      return out;
    });
    const membersWithDisplayUrls = await resolveCloudAvatarUrls(members);

    let qrcodeFileID = room.qrcodeFileID || null;
    let qrcodeUrl = null;
    if (qrcodeFileID) {
      try {
        const tempRes = await cloud.getTempFileURL({ fileList: [qrcodeFileID] });
        const first = tempRes && tempRes.fileList && tempRes.fileList[0];
        if (first && first.tempFileURL) {
          qrcodeUrl = first.tempFileURL;
        }
      } catch (e) {
        console.warn('getAddPlayerData qrcode getTempFileURL failed', e);
      }
    }

    return {
      ok: true,
      serverNow: Date.now(),
      roundTimerMaxSec: 5 * 60,
      qrcodeFileID,
      qrcodeUrl,
      members: membersWithDisplayUrls,
      memberCount: membersWithDisplayUrls.length,
      isHost,
      role: myMember && myMember.role ? myMember.role : (isHost ? 'GOD' : 'PLAYER'),
      workshopName: room.workshopName || '脑暴工作坊',
      workshopDesc: room.workshopDesc || '',
      createdAt: room.createdAt || null,
      joinedAt: myMember && myMember.joinedAt ? myMember.joinedAt : null,
      hasSelectedMode,
      selectedModeId,
      selectedModeTitle: room.selectedModeTitle || '',
      selectedModeDesc: room.selectedModeDesc || '',
      selectedBG: room.selectedBG || null,
      selectedDesignProblem: room.selectedDesignProblem || null,
      roomState,
      // 顶层 revision 供 RoomSession 单调校验；缺省时 normalize 仍会读 roomState.revision
      revision: room.revision != null ? room.revision : null,
      protocolVersion: room.protocolVersion != null ? room.protocolVersion : 1,
      lastEvent,
      event: lastEvent && lastEvent.type ? lastEvent.type : null
    };
  } catch (e) {
    console.error('getAddPlayerData error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'GET_DATA_ERROR',
      errMsg: e.errMsg || e.message || '获取房间数据失败'
    };
  }
};
