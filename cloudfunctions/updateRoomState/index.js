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

function buildFreshScoreProgress(room, currentRound, actingPlayerIndex) {
  const seatCount = room.seatMap
    ? Object.keys(room.seatMap).length
    : (room.currentMemberCount != null ? Number(room.currentMemberCount) : 0);
  const round = currentRound != null ? Number(currentRound) : 1;
  const seat = actingPlayerIndex != null ? Number(actingPlayerIndex) : 1;
  return {
    scoredCount: 0,
    requiredScoreCount: Math.max(0, seatCount - 1),
    votedCount: 0,
    requiredVoteCount: 0,
    turnId: `turn_r${round}_s${seat}`
  };
}

function makeBlockKey(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function splitRecordSegments(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function blocksFromLegacy(texts, images) {
  const blocks = [];
  (Array.isArray(texts) ? texts : []).forEach((t) => {
    splitRecordSegments(typeof t === 'string' ? t : '').forEach((segment) => {
      blocks.push({ type: 'text', text: segment, key: makeBlockKey('t') });
    });
  });
  (Array.isArray(images) ? images : []).forEach((url) => {
    if (typeof url === 'string' && url) {
      blocks.push({ type: 'image', url, key: makeBlockKey('i') });
    }
  });
  return blocks;
}

function normalizeContentBlocks(rawBlocks, legacyTexts, legacyImages) {
  if (Array.isArray(rawBlocks) && rawBlocks.length) {
    const normalized = [];
    rawBlocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      if (b.type === 'text') {
        const text = typeof b.text === 'string' ? b.text : (typeof b.value === 'string' ? b.value : '');
        const segments = splitRecordSegments(text);
        if (!segments.length) return;
        segments.forEach((segment, segIdx) => {
          normalized.push({
            type: 'text',
            text: segment,
            key: typeof b.key === 'string' && b.key && segments.length === 1
              ? b.key
              : `t_${i}_${segIdx}`
          });
        });
        return;
      }
      if (b.type === 'image') {
        const url = typeof b.url === 'string' ? b.url : (typeof b.value === 'string' ? b.value : '');
        if (!url) return;
        normalized.push({
          type: 'image',
          url,
          key: typeof b.key === 'string' && b.key ? b.key : `i_${i}`
        });
      }
    });
    if (normalized.length) return normalized;
  }
  return blocksFromLegacy(legacyTexts, legacyImages);
}

function deriveListsFromBlocks(blocks) {
  const texts = [];
  const images = [];
  (Array.isArray(blocks) ? blocks : []).forEach((b) => {
    if (!b) return;
    if (b.type === 'text' && typeof b.text === 'string' && b.text) texts.push(b.text);
    if (b.type === 'image' && typeof b.url === 'string' && b.url) images.push(b.url);
  });
  return { texts, images };
}

function limitImageBlocks(blocks, maxCount) {
  const max = Math.max(0, Number(maxCount) || 0);
  const list = Array.isArray(blocks) ? blocks : [];
  let n = 0;
  return list.filter((b) => {
    if (!b || b.type !== 'image') return true;
    if (n >= max) return false;
    n += 1;
    return true;
  });
}

function normalizePartnerRoundContent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const legacyImages = Array.isArray(src.images) ? src.images.slice() : [];
  const playImagesRaw = Array.isArray(src.playImages) ? src.playImages.slice() : [];
  const discussionImagesRaw = Array.isArray(src.discussionImages)
    ? src.discussionImages.slice()
    : [];
  const playHistory = Array.isArray(src.playHistory) ? src.playHistory.slice() : [];
  const discussionNotes = Array.isArray(src.discussionNotes) ? src.discussionNotes.slice() : [];
  const playImages = playImagesRaw.length ? playImagesRaw : legacyImages;
  const discussionImages = discussionImagesRaw;
  const playBlocks = normalizeContentBlocks(src.playBlocks, playHistory, playImages);
  const discussionBlocks = normalizeContentBlocks(
    src.discussionBlocks,
    discussionNotes,
    discussionImages
  );
  const playDerived = deriveListsFromBlocks(playBlocks);
  const discussionDerived = deriveListsFromBlocks(discussionBlocks);
  return {
    playHistory: playDerived.texts.length ? playDerived.texts : playHistory,
    discussionNotes: discussionDerived.texts.length ? discussionDerived.texts : discussionNotes,
    playImages: playDerived.images.length ? playDerived.images : playImages,
    discussionImages: discussionDerived.images.length
      ? discussionDerived.images
      : discussionImages,
    playBlocks,
    discussionBlocks,
    images: legacyImages,
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

/** 合并表态记录：优先保留带 avgScore 的服务端版本，避免客户端盖掉均分 */
function mergeTurnRecords(clientList, serverList) {
  const map = new Map();
  const push = (rec) => {
    if (!rec || typeof rec !== 'object') return;
    const key = rec.playerIndex != null ? String(rec.playerIndex) : `_${map.size}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...rec });
      return;
    }
    const merged = { ...prev, ...rec };
    if (prev.avgScore != null && rec.avgScore == null) {
      merged.avgScore = prev.avgScore;
      if (prev.scoredCount != null && merged.scoredCount == null) {
        merged.scoredCount = prev.scoredCount;
      }
    }
    map.set(key, merged);
  };
  (Array.isArray(serverList) ? serverList : []).forEach(push);
  (Array.isArray(clientList) ? clientList : []).forEach(push);
  return Array.from(map.values());
}

function buildArchivedRoundSummary(currentRound, clientSummary, serverContent, meta) {
  const client = clientSummary ? normalizePartnerRoundContent(clientSummary) : null;
  const server = normalizePartnerRoundContent(serverContent);
  const playBlocks = pickPreferredList(client && client.playBlocks, server.playBlocks);
  const discussionBlocks = pickPreferredList(
    client && client.discussionBlocks,
    server.discussionBlocks
  );
  const playDerived = deriveListsFromBlocks(playBlocks);
  const discussionDerived = deriveListsFromBlocks(discussionBlocks);
  const playerIndex = meta && meta.playerIndex != null
    ? Number(meta.playerIndex)
    : (clientSummary && clientSummary.playerIndex != null
      ? Number(clientSummary.playerIndex)
      : null);
  const playerName = (meta && meta.playerName)
    || (clientSummary && clientSummary.playerName)
    || (Number.isFinite(playerIndex) ? `玩家${playerIndex}` : '');
  const out = {
    round: currentRound,
    playHistory: playDerived.texts.length
      ? playDerived.texts
      : pickPreferredList(client && client.playHistory, server.playHistory),
    discussionNotes: discussionDerived.texts.length
      ? discussionDerived.texts
      : pickPreferredList(client && client.discussionNotes, server.discussionNotes),
    playImages: playDerived.images.length
      ? playDerived.images
      : pickPreferredList(client && client.playImages, server.playImages),
    discussionImages: discussionDerived.images.length
      ? discussionDerived.images
      : pickPreferredList(client && client.discussionImages, server.discussionImages),
    playBlocks,
    discussionBlocks,
    images: pickPreferredList(client && client.images, server.images),
    voiceLines: pickPreferredList(client && client.voiceLines, server.voiceLines),
    turnRecords: mergeTurnRecords(
      client && client.turnRecords,
      server.turnRecords
    ),
    aiSummary: server.aiSummary || { status: 'pending' },
    archivedAt: (meta && meta.archivedAt) || Date.now()
  };
  if (Number.isFinite(playerIndex) && playerIndex > 0) {
    out.playerIndex = playerIndex;
    out.playerName = playerName;
  }
  const matchedTurn = (out.turnRecords || []).find(
    (t) => t && Number(t.playerIndex) === Number(out.playerIndex) && t.avgScore != null
  ) || (out.turnRecords || []).find((t) => t && t.avgScore != null);
  if (matchedTurn && matchedTurn.avgScore != null) {
    out.avgScore = Number(matchedTurn.avgScore);
  } else if (clientSummary && clientSummary.avgScore != null) {
    out.avgScore = Number(clientSummary.avgScore);
  }
  return out;
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
    partnerSilentMode,
    partnerSilentStartedAt,
    partnerClosingStep,
    closingQuestionPlayers,
    resetClosingVotes,
    brainstormSessionEnded,
    roundSummary,
    partnerCurrentRoundContent,
    partnerClosingCreativePoints,
    partnerRoundStartedAt,
    editingProblemId,
    partnerSilentSoundLevel,
    /**
     * skipArchive: true 时跳过纪要归档。
     * 用于 ADVANCE_TURN 之后的双写调用：room-domain 已归档，此处只补写计时/phase，不重复归档。
     */
    skipArchive
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

    // 静默声贝：只写分贝字段，禁止改 currentPage / 轮次，避免把其他玩家打回房间页
    const silentSoundOnly = partnerSilentSoundLevel != null
      && Number.isFinite(Number(partnerSilentSoundLevel))
      && currentPage == null
      && currentPlayerIndex == null
      && incrementRound !== true
      && partnerGamePhase == null
      && roundSummary == null
      && partnerCurrentRoundContent == null
      && partnerRoundStartedAt == null;
    if (silentSoundOnly) {
      await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
        data: {
          partnerSilentSoundLevel: Math.min(1, Math.max(0, Number(partnerSilentSoundLevel))),
          updatedAt: Date.now()
        }
      });
      return { ok: true };
    }

    let currentRound = room.currentRound != null ? room.currentRound : 1;
    const emptyRoundContent = {
      playHistory: [],
      discussionNotes: [],
      playImages: [],
      discussionImages: [],
      playBlocks: [],
      discussionBlocks: [],
      images: [],
      voiceLines: [],
      turnRecords: [],
      aiSummary: { status: 'pending' }
    };
    const roundPatch = {};
    const incomingPlayerChanging = currentPlayerIndex != null
      && Number.isFinite(Number(currentPlayerIndex))
      && Number(currentPlayerIndex) !== Number(room.currentPlayerIndex);
    // 只有「结束本轮并换人」（incrementRound）才归档纪要。
    // 不能仅因座位变化归档：选定首位出牌玩家时会从默认玩家1改到玩家2，
    // 否则会先写入一张空的玩家1纪要，表态后再出现玩家1+玩家2两张卡。
    const shouldArchiveTurn = skipArchive !== true && incrementRound === true;
    let archivedThisRequest = false;

    if (incrementRound === true && event.clearBrainstormProgress === true) {
      // 再来一轮：重置到第 1 轮，清空纪要/表达，而不是 currentRound+=1
      roundPatch.partnerRoundSummaries = [];
      roundPatch.partnerCurrentRoundContent = emptyRoundContent;
      roundPatch.partnerClosingCreativePoints = {
        blocks: [],
        texts: [],
        images: []
      };
      roundPatch.partnerExpressMessages = [];
      roundPatch.brainstormSessionSeq = getBrainstormSessionSeq(room) + 1;
      roundPatch.partnerTurnStartedAt = null;
      roundPatch.progress = _.set({
        scoredCount: 0,
        requiredScoreCount: 0,
        votedCount: 0,
        requiredVoteCount: 0,
        turnId: null
      });
      currentRound = 1;
      archivedThisRequest = true;
      // 再来一轮必须清 roomScores，否则 round 回到 1 会读到旧满分
      try {
        const MAX_BATCH = 100;
        let hasMore = true;
        while (hasMore) {
          const scoreRes = await db.collection('roomScores').where({ roomId }).limit(MAX_BATCH).get();
          const docs = (scoreRes && scoreRes.data) || [];
          if (!docs.length) break;
          await Promise.all(docs.map((doc) => db.collection('roomScores').doc(doc._id).remove()));
          if (docs.length < MAX_BATCH) hasMore = false;
        }
      } catch (clearScoreErr) {
        console.warn('[updateRoomState] clear roomScores on brainstorm reset', clearScoreErr);
      }
      roundPatch.partnerRoundStartedAt = Date.now();
    } else if (shouldArchiveTurn) {
      const freshRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
      const contentRoom = (freshRes.data && freshRes.data[0]) || room;
      const serverContent = contentRoom.partnerCurrentRoundContent;
      const clientSummary = roundSummary && typeof roundSummary === 'object' ? roundSummary : null;
      const summaries = Array.isArray(room.partnerRoundSummaries)
        ? room.partnerRoundSummaries.slice()
        : [];
      const actingIdx = room.currentPlayerIndex != null
        ? Number(room.currentPlayerIndex)
        : null;
      summaries.push(buildArchivedRoundSummary(currentRound, clientSummary, serverContent, {
        playerIndex: actingIdx,
        playerName: room.currentPlayerName || (actingIdx != null ? `玩家${actingIdx}` : ''),
        archivedAt: Date.now()
      }));
      roundPatch.partnerRoundSummaries = summaries;
      roundPatch.partnerCurrentRoundContent = emptyRoundContent;
      archivedThisRequest = true;
      if (incrementRound === true) {
        currentRound += 1;
      }
      roundPatch.partnerRoundStartedAt = Date.now();
    }
    if (currentPage === 'auth') {
      currentRound = 1;
    }

    // 仅当客户端明确传入 currentPage 时才覆盖；否则保持房间原 currentPage
    // 否则像“仅同步编辑态 editingProblemId”这类请求会把页面误置回 addPlayer，导致成员端跳转抖动
    const resolvedCurrentPage = currentPage != null
      ? String(currentPage || 'addPlayer').toLowerCase()
      : (room.currentPage || 'addPlayer').toLowerCase();
    const prevPage = (room.currentPage || '').toLowerCase();
    // 已离开表态页后，忽略迟到的 statement 回写（bootstrap / 旧请求），否则全员会被拉回表态页
    const staleStatementWrite = resolvedCurrentPage === 'statement'
      && prevPage === 'gamepage'
      && currentPlayerIndex == null
      && incrementRound !== true
      && partnerGamePhase == null;
    if (staleStatementWrite) {
      return { ok: true, ignored: 'stale_statement_page' };
    }

    const updateData = {
      currentPage: resolvedCurrentPage,
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
    } else if (page && page !== 'addplayer' && page !== 'brainstormmode') {
      updateData.brainstormProgressPage = page;
    }
    if (brainstormSessionEnded === true) {
      updateData.brainstormSessionEnded = true;
    } else if (brainstormSessionEnded === false) {
      updateData.brainstormSessionEnded = false;
    }
    if (currentPlayerIndex != null) updateData.currentPlayerIndex = currentPlayerIndex;
    if (currentPlayerName != null) updateData.currentPlayerName = currentPlayerName;
    // 换人时同步 workflow.activeSeatNo，避免后续 ADVANCE_TURN 读到滞后座位
    if (currentPlayerIndex != null) {
      const seat = Number(currentPlayerIndex);
      if (Number.isFinite(seat) && seat > 0) {
        const prevSeat = room.currentPlayerIndex != null ? Number(room.currentPlayerIndex) : NaN;
        const wfSeat = room.workflow && room.workflow.activeSeatNo != null
          ? Number(room.workflow.activeSeatNo)
          : NaN;
        const playerChanging = Number.isFinite(prevSeat) && prevSeat !== seat;
        const workflowLagging = !Number.isFinite(wfSeat) || wfSeat !== seat;
        if (playerChanging || workflowLagging || incrementRound === true) {
          updateData.workflow = {
            ...(room.workflow && typeof room.workflow === 'object' ? room.workflow : {}),
            mode: (room.workflow && room.workflow.mode) || 'PARTNER',
            step: 'TURN_ACTIVE',
            activeSeatNo: seat,
            roundNo: currentRound,
            turnId: `turn_r${currentRound}_s${seat}`,
            legacyPage: updateData.currentPage || 'gamepage'
          };
        }
      }
    }
    // 从表态页回到对局：清掉 STATEMENT step，避免轮询仍按「表态中」把人拉回去
    if (resolvedCurrentPage === 'gamepage' && prevPage === 'statement') {
      const baseWf = updateData.workflow
        || (room.workflow && typeof room.workflow === 'object' ? room.workflow : {});
      updateData.workflow = {
        ...baseWf,
        mode: baseWf.mode || 'PARTNER',
        step: 'TURN_ACTIVE',
        legacyPage: 'gamepage'
      };
    }
    // 换人/换轮进入 gamepage：必须清零评分进度，否则上一回合满分会让「开始表态」误亮
    {
      const pageKey = (currentPage || updateData.currentPage || '').toLowerCase();
      const playerChanging = currentPlayerIndex != null
        && Number(currentPlayerIndex) !== Number(room.currentPlayerIndex);
      if (pageKey === 'gamepage' && (playerChanging || incrementRound === true)) {
        const actingIdx = currentPlayerIndex != null
          ? Number(currentPlayerIndex)
          : Number(room.currentPlayerIndex);
        updateData.progress = _.set(buildFreshScoreProgress(room, currentRound, actingIdx));
        // 进度按当前回合查询，保留历史 roomScores 供回顾/排行榜读取均分
      }
    }
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
      // 必须用 _.set：selectedBG 曾被写成 null 时，浅合并会报
      // Cannot create field 'function' in element {selectedBG: null}
      updateData.selectedBG = _.set(bgData);
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
    // 选择设计问题页：房主编辑态同步给成员（空字符串表示退出编辑）
    if (editingProblemId !== undefined) {
      if (!isCreator) {
        return {
          ok: false,
          errCode: 'NO_PERMISSION',
          errMsg: '仅房主可同步编辑态'
        };
      }
      const eid = editingProblemId == null ? '' : String(editingProblemId);
      updateData.editingProblemId = eid;
    }
    if (partnerGamePhase != null && partnerGamePhase !== '') {
      const phase = String(partnerGamePhase);
      if (phase === 'closing') {
        updateData.partnerGamePhase = phase;
        // legacy 写 phase 也抬 revision，避免 RoomSession 被 revision=0 快照回打
        updateData.revision = _.inc(1);
      } else if (phase === 'play' || phase === 'discussion') {
        if (!isCreator) {
          return {
            ok: false,
            errCode: 'NO_PERMISSION',
            errMsg: '仅房主可更新游戏阶段'
          };
        }
        updateData.partnerGamePhase = phase;
        updateData.revision = _.inc(1);
      }
    }
    if (partnerMasterMode === true) {
      updateData.partnerMasterMode = true;
    } else if (partnerMasterMode === false) {
      updateData.partnerMasterMode = false;
    }
    // 全场静默：边框/倒计时锚点同步到全员（与 MASTER 对称）
    if (partnerSilentMode === true) {
      updateData.partnerSilentMode = true;
      const silentAt = partnerSilentStartedAt != null && Number.isFinite(Number(partnerSilentStartedAt))
        ? Number(partnerSilentStartedAt)
        : Date.now();
      updateData.partnerSilentStartedAt = silentAt;
    } else if (partnerSilentMode === false) {
      updateData.partnerSilentMode = false;
      updateData.partnerSilentStartedAt = null;
      updateData.partnerSilentSoundLevel = 0;
    } else if (
      partnerSilentStartedAt != null
      && Number.isFinite(Number(partnerSilentStartedAt))
    ) {
      updateData.partnerSilentStartedAt = Number(partnerSilentStartedAt);
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
    if (partnerClosingCreativePoints && typeof partnerClosingCreativePoints === 'object') {
      // 收尾创意点复盘：仅房主可写（文字/拍照），其他成员只读
      if (!isCreator) {
        return {
          ok: false,
          errCode: 'NO_PERMISSION',
          errMsg: '仅房主可编辑创意点复盘'
        };
      }
      const incoming = partnerClosingCreativePoints;
      const blocks = limitImageBlocks(normalizeContentBlocks(
        incoming.blocks,
        incoming.texts || incoming.playHistory,
        incoming.images
      ), 1);
      const derived = deriveListsFromBlocks(blocks);
      updateData.partnerClosingCreativePoints = {
        blocks,
        texts: derived.texts,
        images: derived.images,
        updatedAt: Date.now()
      };
    }
    if (partnerCurrentRoundContent && typeof partnerCurrentRoundContent === 'object') {
      // 同请求已换轮：上一轮纪要已归档并清空，禁止再用旧内容写回新轮
      const skippedForRoundAdvance = archivedThisRequest === true;
      // 客户端声明内容所属轮次；与当前房间轮次不一致则丢弃（防过期同步串轮）
      const contentRound = event.contentRound != null ? Number(event.contentRound) : null;
      const roomRound = Number(updateData.currentRound);
      const roundMismatch = contentRound != null
        && Number.isFinite(contentRound)
        && contentRound !== roomRound;

      if (!skippedForRoundAdvance && !roundMismatch) {
        // 若本请求已清空当前轮内容，以此为准，勿读换轮前的旧快照
        const existing = normalizePartnerRoundContent(
          updateData.partnerCurrentRoundContent != null
            ? updateData.partnerCurrentRoundContent
            : room.partnerCurrentRoundContent
        );
        const incoming = partnerCurrentRoundContent;
        const incomingVoiceLines = Array.isArray(incoming.voiceLines) ? incoming.voiceLines : [];
        const incomingTurnRecords = Array.isArray(incoming.turnRecords) ? incoming.turnRecords : [];
        const wantsPlayNotes = Array.isArray(incoming.playHistory)
          || Array.isArray(incoming.playImages)
          || Array.isArray(incoming.playBlocks)
          || Array.isArray(incoming.images);
        const wantsDiscussionNotes = Array.isArray(incoming.discussionNotes)
          || Array.isArray(incoming.discussionImages)
          || Array.isArray(incoming.discussionBlocks);
        const wantsSharedNotes = wantsPlayNotes || wantsDiscussionNotes;

        // 出牌解释：房主或当前出牌玩家；疑问讨论：仅房主
        let allowPlayNotes = isCreator;
        let allowDiscussionNotes = isCreator;
        if (wantsSharedNotes && !isCreator) {
          const member = membersRes.data && membersRes.data[0];
          const callerPlayerIndex = member && member.playerIndex != null
            ? Number(member.playerIndex)
            : NaN;
          const isActingPlayer = Number.isFinite(callerPlayerIndex)
            && Number(room.currentPlayerIndex) === callerPlayerIndex;
          if (!isActingPlayer) {
            return {
              ok: false,
              errCode: 'NO_PERMISSION',
              errMsg: '仅房主或当前出牌玩家可编辑出牌解释'
            };
          }
          if (wantsDiscussionNotes) {
            return {
              ok: false,
              errCode: 'NO_PERMISSION',
              errMsg: '仅房主可编辑疑问讨论'
            };
          }
          allowPlayNotes = true;
          allowDiscussionNotes = false;
        }

        const nextPlayBlocks = allowPlayNotes && Array.isArray(incoming.playBlocks)
          ? normalizeContentBlocks(incoming.playBlocks, incoming.playHistory, incoming.playImages)
          : existing.playBlocks;
        const nextDiscussionBlocks = allowDiscussionNotes && Array.isArray(incoming.discussionBlocks)
          ? normalizeContentBlocks(
            incoming.discussionBlocks,
            incoming.discussionNotes,
            incoming.discussionImages
          )
          : existing.discussionBlocks;
        const playDerived = deriveListsFromBlocks(nextPlayBlocks);
        const discussionDerived = deriveListsFromBlocks(nextDiscussionBlocks);
        updateData.partnerCurrentRoundContent = {
          playHistory: allowPlayNotes
            ? (playDerived.texts.length
              ? playDerived.texts
              : (Array.isArray(incoming.playHistory) ? incoming.playHistory : existing.playHistory))
            : existing.playHistory,
          discussionNotes: allowDiscussionNotes
            ? (discussionDerived.texts.length
              ? discussionDerived.texts
              : (Array.isArray(incoming.discussionNotes)
                ? incoming.discussionNotes
                : existing.discussionNotes))
            : existing.discussionNotes,
          playImages: allowPlayNotes
            ? (playDerived.images.length
              ? playDerived.images
              : (Array.isArray(incoming.playImages) ? incoming.playImages : existing.playImages))
            : existing.playImages,
          discussionImages: allowDiscussionNotes
            ? (discussionDerived.images.length
              ? discussionDerived.images
              : (Array.isArray(incoming.discussionImages)
                ? incoming.discussionImages
                : existing.discussionImages))
            : existing.discussionImages,
          playBlocks: nextPlayBlocks,
          discussionBlocks: nextDiscussionBlocks,
          images: allowPlayNotes && Array.isArray(incoming.images)
            ? incoming.images
            : existing.images,
          // 语音/表态记录仍由房主侧云函数维护；玩家同步不覆盖
          voiceLines: isCreator && incomingVoiceLines.length
            ? incomingVoiceLines
            : existing.voiceLines,
          turnRecords: isCreator && incomingTurnRecords.length
            ? incomingTurnRecords
            : existing.turnRecords,
          aiSummary: existing.aiSummary
        };
      }
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

    if (partnerSilentSoundLevel != null && Number.isFinite(Number(partnerSilentSoundLevel))) {
      updateData.partnerSilentSoundLevel = Math.min(1, Math.max(0, Number(partnerSilentSoundLevel)));
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
