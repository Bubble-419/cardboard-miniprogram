const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

const NON_RESUMABLE_PROGRESS_PAGES = ['closingend', 'closingstatement'];

function isNonResumableProgressPage(page) {
  return NON_RESUMABLE_PROGRESS_PAGES.includes((page || '').toLowerCase());
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
        errMsg: '房间不存在'
      };
    }

    const room = roomRes.data[0];
    if (room.status === 'DISSOLVED') {
      return {
        ok: false,
        errCode: 'ROOM_DISSOLVED',
        errMsg: '房间已解散',
        roomDissolved: true
      };
    }

    const isHost = !!(room.creatorId && room.creatorId === currentUserId);
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
      memberCount: room.currentMemberCount != null ? room.currentMemberCount : null,
      partnerGamePhase: room.partnerGamePhase || 'play',
      partnerMasterMode: room.partnerMasterMode === true,
      partnerClosingStep: room.partnerClosingStep || 'rune',
      closingQuestionPlayers: Array.isArray(room.closingQuestionPlayers)
        ? room.closingQuestionPlayers
        : [],
      closingVotes: room.closingVotes || {},
      partnerRoundStartedAt: room.partnerRoundStartedAt != null ? room.partnerRoundStartedAt : null,
      partnerRoundSummaries: Array.isArray(room.partnerRoundSummaries) ? room.partnerRoundSummaries : [],
      partnerCurrentRoundContent: room.partnerCurrentRoundContent || {
        playHistory: [],
        discussionNotes: [],
        images: [],
        voiceLines: [],
        turnRecords: [],
        aiSummary: { status: 'pending' }
      }
    };

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .orderBy('playerIndex', 'asc')
      .get();

    const rawMembers = membersRes.data || [];
    const myMember = rawMembers.find(m => m.userId === currentUserId) || null;

    if (!isHost && !myMember) {
      return {
        ok: false,
        errCode: 'NOT_IN_ROOM',
        errMsg: '您已不在该房间'
      };
    }

    const members = rawMembers.map(m => {
      const out = {
        playerIndex: m.playerIndex,
        nickName: m.nickName || `玩家${m.playerIndex}`,
        avatarColor: m.avatarColor || '#5EC159',
        isMe: m.userId === currentUserId,
        userId: m.userId || null
      };
      if (m.avatarIndex != null) out.avatarIndex = m.avatarIndex;
      return out;
    });

    return {
      ok: true,
      qrcodeFileID: room.qrcodeFileID || null,
      members,
      memberCount: members.length,
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
      roomState
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
