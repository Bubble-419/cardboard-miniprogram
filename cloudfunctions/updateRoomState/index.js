const cloud = require('wx-server-sdk');
const {
  getBrainstormSessionSeq,
  buildEmptyClosingVoteState,
  buildNewClosingVoteState,
  normalizeClosingVoteState
} = require('./closingVoteState');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const ROOMS_COLLECTION = 'rooms';
const PROBLEMS_COLLECTION = 'designProblems';
const DESIGN_PROBLEM_ENTRY = 'designProblem';
const CREATIVE_IDEA_ENTRY = 'creativeIdea';

function clearClosingVoteFields(updateData, brainstormSessionSeq) {
  // 必须用 _.set：云库对象字段是浅合并，votes:{} 清不掉旧票
  const emptyState = buildEmptyClosingVoteState(brainstormSessionSeq);
  updateData.closingVotes = _.set({});
  updateData.closingQuestionPlayers = _.set([]);
  updateData.closingVoteState = _.set(emptyState);
  return emptyState;
}

function normalizePartnerRoundContent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    playHistory: Array.isArray(src.playHistory) ? src.playHistory.slice() : [],
    discussionNotes: Array.isArray(src.discussionNotes) ? src.discussionNotes.slice() : [],
    images: Array.isArray(src.images) ? src.images.slice() : [],
    voiceLines: Array.isArray(src.voiceLines) ? src.voiceLines.slice() : [],
    turnRecords: Array.isArray(src.turnRecords) ? src.turnRecords.slice() : [],
    aiSummary: src.aiSummary && typeof src.aiSummary === 'object'
      ? { ...src.aiSummary }
      : { status: 'pending' }
  };
}

function pickPreferredList(clientList, serverList) {
  if (Array.isArray(clientList) && clientList.length) return clientList;
  if (Array.isArray(serverList) && serverList.length) return serverList;
  return Array.isArray(clientList) ? clientList : (Array.isArray(serverList) ? serverList : []);
}

function buildArchivedRoundSummary(currentRound, clientSummary, serverContent) {
  const client = clientSummary ? normalizePartnerRoundContent(clientSummary) : null;
  const server = normalizePartnerRoundContent(serverContent);
  return {
    round: currentRound,
    playHistory: client && client.playHistory.length ? client.playHistory : server.playHistory,
    discussionNotes: client && client.discussionNotes.length ? client.discussionNotes : server.discussionNotes,
    images: client && client.images.length ? client.images : server.images,
    voiceLines: pickPreferredList(client && client.voiceLines, server.voiceLines),
    turnRecords: pickPreferredList(client && client.turnRecords, server.turnRecords),
    aiSummary: server.aiSummary || { status: 'pending' }
  };
}

/**
 * 房主更新房间当前页面状态，供普通玩家跟随跳转
 * 仅房间创建者可调用
 */
exports.main = async (event, context) => {
  const {
    roomId,
    currentPage,
    currentPlayerIndex,
    currentPlayerName,
    incrementRound,
    passCount,
    memberCount,
    resetDesignProblems,
    selectedBG,
    selectedDesignProblem,
    partnerGamePhase,
    partnerMasterMode,
    partnerClosingStep,
    closingQuestionPlayers,
    resetClosingVotes,
    brainstormSessionEnded,
    roundSummary,
    partnerCurrentRoundContent,
    partnerRoundStartedAt
  } = event || {};

  if (!roomId || typeof roomId !== 'string') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId is required'
    };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      console.warn('[updateRoomState] 房间不存在', roomId);
      return {
        ok: false,
        errCode: 'ROOM_NOT_FOUND',
        errMsg: '房间不存在'
      };
    }

    const room = roomRes.data[0];
    const creatorId = room.creatorId || room.creator_id;
    const isCreator = !creatorId || String(creatorId) === String(currentUserId);
    const membersRes = creatorId && !isCreator
      ? await db.collection('roomMembers').where({ roomId, userId: currentUserId }).limit(1).get()
      : { data: [] };
    const isMember = membersRes.data && membersRes.data.length > 0;
    if (!isCreator && !isMember) {
      console.warn('[updateRoomState] 无权限', { roomCreatorId: creatorId, callerOpenId: currentUserId });
      return {
        ok: false,
        errCode: 'NO_PERMISSION',
        errMsg: '仅房主可更新房间状态'
      };
    }

    let currentRound = room.currentRound != null ? room.currentRound : 1;
    const emptyRoundContent = { playHistory: [], discussionNotes: [], images: [], voiceLines: [], turnRecords: [], aiSummary: { status: 'pending' } };
    const roundPatch = {};

    if (incrementRound === true) {
      if (event.clearBrainstormProgress === true) {
        roundPatch.partnerRoundSummaries = [];
        roundPatch.partnerCurrentRoundContent = emptyRoundContent;
        roundPatch.brainstormSessionSeq = getBrainstormSessionSeq(room) + 1;
        roundPatch.partnerTurnStartedAt = null;
      } else {
        const freshRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
        const contentRoom = (freshRes.data && freshRes.data[0]) || room;
        const serverContent = contentRoom.partnerCurrentRoundContent;
        const clientSummary = roundSummary && typeof roundSummary === 'object' ? roundSummary : null;
        if (serverContent || clientSummary) {
          const summaries = Array.isArray(room.partnerRoundSummaries)
            ? room.partnerRoundSummaries.slice()
            : [];
          summaries.push(buildArchivedRoundSummary(currentRound, clientSummary, serverContent));
          roundPatch.partnerRoundSummaries = summaries;
          roundPatch.partnerCurrentRoundContent = emptyRoundContent;
        }
      }
      currentRound += 1;
      roundPatch.partnerRoundStartedAt = Date.now();
    }
    if (currentPage === 'auth') {
      currentRound = 1;
    }

    const updateData = {
      currentPage: (currentPage || 'addPlayer').toLowerCase(),
      currentRound,
      updatedAt: Date.now(),
      ...roundPatch
    };

    if (resetDesignProblems === true) {
      if (!isCreator) {
        return {
          ok: false,
          errCode: 'NO_PERMISSION',
          errMsg: '仅房主可开始提交问题'
        };
      }
      try {
        await db.collection(PROBLEMS_COLLECTION).where({ roomId, entryType: DESIGN_PROBLEM_ENTRY }).remove();
      } catch (clearErr) {
        console.warn('[updateRoomState] clear design problems skipped', clearErr);
      }
      updateData.selectedDesignProblem = db.command.remove();
    }

    if (event.startCreativeSession === true) {
      if (!isCreator) {
        return {
          ok: false,
          errCode: 'NO_PERMISSION',
          errMsg: '仅房主可开启创意环节'
        };
      }
      const prevSeq = room.creativeSessionSeq != null ? room.creativeSessionSeq : 0;
      updateData.creativeSessionSeq = prevSeq + 1;
    }

    if (event.resetCreativeIdeas === true) {
      if (!isCreator) {
        return {
          ok: false,
          errCode: 'NO_PERMISSION',
          errMsg: '仅房主可重置创意记录'
        };
      }
      try {
        await db.collection(PROBLEMS_COLLECTION).where({ roomId, entryType: CREATIVE_IDEA_ENTRY }).remove();
      } catch (clearErr) {
        console.warn('[updateRoomState] clear creative ideas skipped', clearErr);
      }
    }

    const page = updateData.currentPage;
    const prevPage = (room.currentPage || '').toLowerCase();
    const sessionSeq = updateData.brainstormSessionSeq != null
      ? updateData.brainstormSessionSeq
      : getBrainstormSessionSeq(room);
    const enteringClosing = page === 'closingstatement';
    let resolvedClosingVoteState = null;
    // 新开一轮收尾表态：必须换新 session，禁止沿用上一轮 closingVotes
    if (enteringClosing) {
      const forceNewSession = prevPage !== 'closingstatement' || resetClosingVotes === true;
      if (forceNewSession) {
        resolvedClosingVoteState = buildNewClosingVoteState(room, sessionSeq);
        updateData.closingVotes = _.set({});
        updateData.closingQuestionPlayers = _.set([]);
        updateData.closingVoteState = _.set(resolvedClosingVoteState);
      } else if (
        !normalizeClosingVoteState(room.closingVoteState, sessionSeq)
        && Object.keys(
          (room.closingVoteState && room.closingVoteState.votes) || room.closingVotes || {}
        ).length > 0
      ) {
        // 旧数据残留且无有效 session：强制开新会话
        resolvedClosingVoteState = buildNewClosingVoteState(room, sessionSeq);
        updateData.closingVotes = _.set({});
        updateData.closingQuestionPlayers = _.set([]);
        updateData.closingVoteState = _.set(resolvedClosingVoteState);
      }
    } else if (resetClosingVotes === true) {
      resolvedClosingVoteState = clearClosingVoteFields(updateData, sessionSeq);
    }
    if (event.clearBrainstormProgress === true || brainstormSessionEnded === true) {
      updateData.brainstormProgressPage = null;
      resolvedClosingVoteState = clearClosingVoteFields(updateData, sessionSeq);
    } else if (page && page !== 'addplayer') {
      updateData.brainstormProgressPage = page;
    }
    if (brainstormSessionEnded === true) {
      updateData.brainstormSessionEnded = true;
    } else if (brainstormSessionEnded === false) {
      updateData.brainstormSessionEnded = false;
    }
    if (currentPlayerIndex != null) updateData.currentPlayerIndex = currentPlayerIndex;
    if (currentPlayerName != null) updateData.currentPlayerName = currentPlayerName;
    if (passCount != null && Number.isFinite(Number(passCount))) {
      updateData.currentPassCount = Number(passCount);
    }
    if (memberCount != null && Number.isFinite(Number(memberCount))) {
      updateData.currentMemberCount = Number(memberCount);
    }
    if (selectedBG && typeof selectedBG === 'object') {
      if (!isCreator) {
        return {
          ok: false,
          errCode: 'NO_PERMISSION',
          errMsg: '仅房主可保存情境'
        };
      }
      const bgData = {
        scene: selectedBG.scene || '',
        user: selectedBG.user || '',
        function: selectedBG.function || ''
      };
      if (selectedBG.platform) bgData.platform = selectedBG.platform;
      updateData.selectedBG = bgData;
    }
    if (selectedDesignProblem && typeof selectedDesignProblem === 'object') {
      if (!isCreator) {
        return {
          ok: false,
          errCode: 'NO_PERMISSION',
          errMsg: '仅房主可保存设计问题'
        };
      }
      const text = (selectedDesignProblem.text || '').trim();
      if (text) {
        updateData.selectedDesignProblem = {
          id: selectedDesignProblem.id || '',
          text
        };
      }
    }
    if (partnerGamePhase != null && partnerGamePhase !== '') {
      const phase = String(partnerGamePhase);
      if (phase === 'closing') {
        updateData.partnerGamePhase = phase;
      } else if (phase === 'play' || phase === 'discussion') {
        if (!isCreator) {
          return {
            ok: false,
            errCode: 'NO_PERMISSION',
            errMsg: '仅房主可更新游戏阶段'
          };
        }
        updateData.partnerGamePhase = phase;
      }
    }
    if (partnerMasterMode === true) {
      updateData.partnerMasterMode = true;
    } else if (partnerMasterMode === false) {
      updateData.partnerMasterMode = false;
    }
    if (partnerClosingStep != null && partnerClosingStep !== '') {
      const step = String(partnerClosingStep);
      if (step === 'rune' || step === 'review') {
        if (!isCreator) {
          return {
            ok: false,
            errCode: 'NO_PERMISSION',
            errMsg: '仅房主可更新收尾步骤'
          };
        }
        updateData.partnerClosingStep = step;
      }
    }
    if (Array.isArray(closingQuestionPlayers)) {
      updateData.closingQuestionPlayers = closingQuestionPlayers;
    }
    if (partnerCurrentRoundContent && typeof partnerCurrentRoundContent === 'object') {
      const existing = normalizePartnerRoundContent(room.partnerCurrentRoundContent);
      const incoming = partnerCurrentRoundContent;
      const incomingVoiceLines = Array.isArray(incoming.voiceLines) ? incoming.voiceLines : [];
      const incomingTurnRecords = Array.isArray(incoming.turnRecords) ? incoming.turnRecords : [];
      updateData.partnerCurrentRoundContent = {
        playHistory: incoming.playHistory || [],
        discussionNotes: incoming.discussionNotes || [],
        images: incoming.images || [],
        voiceLines: incomingVoiceLines.length ? incomingVoiceLines : existing.voiceLines,
        turnRecords: incomingTurnRecords.length ? incomingTurnRecords : existing.turnRecords,
        aiSummary: existing.aiSummary
      };
    }
    if (partnerRoundStartedAt != null && Number.isFinite(Number(partnerRoundStartedAt))) {
      const nextStartedAt = Number(partnerRoundStartedAt);
      updateData.partnerRoundStartedAt = nextStartedAt;
      // 头像框倒计时锚点：仅在换人/换轮/显式同步时更新；卡片循环重启不刷新
      const playerChanging = currentPlayerIndex != null
        && Number(currentPlayerIndex) !== Number(room.currentPlayerIndex);
      let shouldSyncTurnTimer = playerChanging || incrementRound === true;
      if (event.syncPartnerTurnTimer === true) {
        shouldSyncTurnTimer = true;
      } else if (event.syncPartnerTurnTimer === false) {
        // 卡片倒计时循环：明确禁止刷新头像锚点
        shouldSyncTurnTimer = false;
      } else if (room.partnerTurnStartedAt == null) {
        shouldSyncTurnTimer = true;
      }
      if (shouldSyncTurnTimer) {
        updateData.partnerTurnStartedAt = nextStartedAt;
      }
    }

    const updateRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: updateData
    });
    const updated = (updateRes && updateRes.stats && updateRes.stats.updated) || 0;
    if (updated === 0) {
      console.warn('[updateRoomState] 未更新到任何记录', { roomId, updateRes });
    }

    const closingVoteState = resolvedClosingVoteState
      || normalizeClosingVoteState(room.closingVoteState, sessionSeq)
      || null;
    return {
      ok: true,
      currentPage: updateData.currentPage,
      closingVoteSessionId: closingVoteState && closingVoteState.sessionId
        ? closingVoteState.sessionId
        : 0,
      closingVoteSeq: closingVoteState && closingVoteState.seq
        ? closingVoteState.seq
        : 0
    };
  } catch (e) {
    console.error('updateRoomState error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'UPDATE_ERROR',
      errMsg: e.errMsg || e.message || '更新房间状态失败'
    };
  }
};
