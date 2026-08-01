const cloud = require('wx-server-sdk');
const { resolveActiveClosingVotes } = require('./closingVoteState');
const { syncRoomAfterMemberRemoved } = require('./memberSync');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

/** 未轮询刷新超过该时长视为断线，移出房间（毫秒） */
const PRESENCE_TIMEOUT_MS = 90 * 1000;

const NON_RESUMABLE_PROGRESS_PAGES = ['closingend', 'closingstatement'];

function isNonResumableProgressPage(page) {
  return NON_RESUMABLE_PROGRESS_PAGES.includes((page || '').toLowerCase());
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

/**
 * 触摸当前用户在线心跳；清理超时未刷新的非房主成员，并写入 lastEvent
 * @returns {{ members: Array, room: object, lastEvent: object|null }}
 */
async function touchPresenceAndPrune(room, roomId, currentUserId, members) {
  const now = Date.now();
  let list = Array.isArray(members) ? members.slice() : [];
  let lastEvent = room.lastEvent || null;
  let liveRoom = room;

  const myMember = list.find((m) => m && String(m.userId) === String(currentUserId)) || null;
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

  const hostUserId = room.creatorId;
  const stale = list.filter((m) => {
    if (!m || !m._id) return false;
    if (hostUserId && String(m.userId) === String(hostUserId)) return false;
    if (String(m.userId) === String(currentUserId)) return false;
    // 仅清理已建立心跳的成员，避免旧数据无 lastSeenAt 被误踢
    if (m.lastSeenAt == null || m.lastSeenAt === '') return false;
    return now - Number(m.lastSeenAt) > PRESENCE_TIMEOUT_MS;
  });

  if (!stale.length) {
    return { members: list, room: liveRoom, lastEvent };
  }

  for (let i = 0; i < stale.length; i += 1) {
    try {
      await db.collection(ROOM_MEMBERS_COLLECTION).doc(stale[i]._id).remove();
    } catch (e) {
      console.warn('prune stale member failed', e);
    }
  }

  const remainRes = await db
    .collection(ROOM_MEMBERS_COLLECTION)
    .where({ roomId })
    .orderBy('playerIndex', 'asc')
    .get();
  list = remainRes.data || [];

  const lastRemoved = stale[stale.length - 1];
  try {
    const sync = await syncRoomAfterMemberRemoved(
      db,
      liveRoom,
      roomId,
      { userId: lastRemoved.userId, playerIndex: lastRemoved.playerIndex },
      list
    );
    lastEvent = sync.event || lastEvent;
  } catch (e) {
    console.error('sync after prune failed', e);
  }

  // 重新读取房间（sync 可能已回退局况）
  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (roomRes.data && roomRes.data[0]) {
      liveRoom = roomRes.data[0];
      if (liveRoom.lastEvent) lastEvent = liveRoom.lastEvent;
    }
  } catch (e) {
    // ignore
  }

  return { members: list, room: liveRoom, lastEvent };
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
  const list = (members || []).map((m) => {
    if (!m) return m;
    // 本机临时路径无法跨设备加载，返回前清掉，客户端回退 avatarIndex
    if (isLocalTempAvatar(m.avatarUrl)) {
      return { ...m, avatarUrl: null };
    }
    return m;
  });
  const fileIds = [];
  list.forEach((m) => {
    const url = m && m.avatarUrl;
    if (typeof url === 'string' && url.startsWith('cloud://') && !fileIds.includes(url)) {
      fileIds.push(url);
    }
  });
  if (!fileIds.length) return list;

  try {
    const res = await cloud.getTempFileURL({ fileList: fileIds });
    const urlMap = {};
    (res.fileList || []).forEach((item) => {
      if (item.fileID && item.tempFileURL) {
        urlMap[item.fileID] = item.tempFileURL;
      }
    });
    return list.map((m) => {
      if (m && m.avatarUrl && urlMap[m.avatarUrl]) {
        return { ...m, avatarUrl: urlMap[m.avatarUrl] };
      }
      if (m && typeof m.avatarUrl === 'string' && m.avatarUrl.startsWith('cloud://')) {
        return { ...m, avatarUrl: null };
      }
      return m;
    });
  } catch (e) {
    console.warn('resolveCloudAvatarUrls failed', e);
    return list.map((m) => {
      if (m && typeof m.avatarUrl === 'string' && m.avatarUrl.startsWith('cloud://')) {
        return { ...m, avatarUrl: null };
      }
      return m;
    });
  }
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
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

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
    if (room.status === 'DISSOLVED') {
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
    let myMember = rawMembers.find((m) => m.userId === currentUserId) || null;
    let isHost = !!(room.creatorId && String(room.creatorId) === String(currentUserId));

    if (!isHost && !myMember) {
      return {
        ok: false,
        errCode: 'NOT_IN_ROOM',
        errMsg: '您已不在该房间'
      };
    }

    // 在线心跳 + 断线超时移出（90s）；可能写 lastEvent / 回退局况
    const presence = await touchPresenceAndPrune(room, roomId, currentUserId, rawMembers);
    room = presence.room || room;
    rawMembers = presence.members || rawMembers;
    myMember = rawMembers.find((m) => m.userId === currentUserId) || null;
    const lastEvent = presence.lastEvent || room.lastEvent || null;

    if (room.status === 'DISSOLVED') {
      return {
        ok: false,
        errCode: 'ROOM_DISSOLVED',
        errMsg: '房间已解散',
        roomDissolved: true,
        event: 'room_dissolved',
        roomId
      };
    }

    isHost = !!(room.creatorId && String(room.creatorId) === String(currentUserId));
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
      (currentPage === 'addPlayer' || !room.currentPage) &&
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

    const roomState = {
      selectedModeId: selectedModeId || null,
      selectedDesignProblem: room.selectedDesignProblem || null,
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
      spyGame: buildPublicSpyGame(room.spyGame, isHost, room.spyAssignments)
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

    const members = rawMembers.map((m) => {
      const out = {
        playerIndex: m.playerIndex,
        nickName: m.nickName || `玩家${m.playerIndex}`,
        avatarColor: m.avatarColor || '#5EC159',
        avatarUrl: m.avatarUrl || null,
        isMe: m.userId === currentUserId,
        userId: m.userId || null,
        role: m.role || 'PLAYER'
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
