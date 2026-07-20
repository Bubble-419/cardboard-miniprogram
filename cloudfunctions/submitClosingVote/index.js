const cloud = require('wx-server-sdk');
const {
  getBrainstormSessionSeq,
  buildEmptyClosingVoteState,
  normalizeClosingVoteState
} = require('./closingVoteState');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

/**
 * 收尾阶段表态：每位玩家投「通过」或「存在疑问」
 * 全员通过 → gamepage 补全符文；有人疑问 → gamepage 出牌解释，从顺位第一个有疑问的玩家继续
 */
exports.main = async (event, context) => {
  const { roomId, vote } = event || {};

  if (!roomId || !vote) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId, vote 必填'
    };
  }

  const normalizedVote = String(vote);
  if (normalizedVote !== 'pass' && normalizedVote !== 'question') {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'vote 需为 pass 或 question'
    };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    const room = roomRes.data && roomRes.data[0];
    if (!room) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const page = (room.currentPage || '').toLowerCase();
    if (page !== 'closingstatement') {
      return {
        ok: false,
        errCode: 'NOT_IN_CLOSING_VOTE',
        errMsg: '当前不在收尾表态阶段'
      };
    }

    const sessionSeq = getBrainstormSessionSeq(room);
    const voteState = normalizeClosingVoteState(room.closingVoteState, sessionSeq);
    if (!voteState) {
      return {
        ok: false,
        errCode: 'VOTE_SESSION_INVALID',
        errMsg: '表态会话已失效，请重新进入收尾阶段'
      };
    }

    const memberRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId, userId: currentUserId })
      .limit(1)
      .get();
    const myMember = memberRes.data && memberRes.data[0];
    if (!myMember) {
      return { ok: false, errCode: 'NOT_MEMBER', errMsg: '非房间成员' };
    }

    const playerIndex = myMember.playerIndex;
    const closingVotes = { ...(voteState.votes || {}) };
    const voteKey = String(playerIndex);

    if (closingVotes[voteKey]) {
      return {
        ok: false,
        errCode: 'ALREADY_VOTED',
        errMsg: '您已表态'
      };
    }

    closingVotes[voteKey] = normalizedVote;

    const membersCountRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .count();
    const totalMembers = (membersCountRes && membersCountRes.total) || 0;

    const nextState = {
      ...voteState,
      votes: closingVotes
    };

    const updateData = {
      closingVotes: _.set(closingVotes),
      // _.set 整段替换，避免 votes 浅合并残留
      closingVoteState: _.set(nextState),
      updatedAt: Date.now()
    };

    let resolvedQuestionPlayers = Array.isArray(room.closingQuestionPlayers)
      ? room.closingQuestionPlayers.slice()
      : [];
    if (normalizedVote === 'question' && !resolvedQuestionPlayers.includes(playerIndex)) {
      resolvedQuestionPlayers.push(playerIndex);
      updateData.closingQuestionPlayers = _.set(resolvedQuestionPlayers);
    }

    const votedCount = Object.keys(closingVotes).length;
    let settledCurrentPlayerIndex = room.currentPlayerIndex != null ? room.currentPlayerIndex : 1;
    if (votedCount >= totalMembers && totalMembers > 0) {
      const hasQuestion = Object.values(closingVotes).some((v) => v === 'question');
      // 结算后立刻清空选票，避免下次进表态页读到残留
      updateData.closingVotes = _.set({});
      updateData.closingVoteState = _.set(buildEmptyClosingVoteState(sessionSeq));
      updateData.partnerMasterMode = false;
      updateData.currentPage = 'gamepage';
      updateData.closingQuestionPlayers = _.set([]);
      resolvedQuestionPlayers = [];

      const now = Date.now();
      updateData.partnerRoundStartedAt = now;
      updateData.partnerTurnStartedAt = now;

      if (hasQuestion) {
        const questionIndices = Object.entries(closingVotes)
          .filter(([, voteValue]) => voteValue === 'question')
          .map(([key]) => parseInt(key, 10))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);
        const firstQuestionIndex = questionIndices[0];
        if (firstQuestionIndex != null) {
          const allMembersRes = await db
            .collection(ROOM_MEMBERS_COLLECTION)
            .where({ roomId })
            .get();
          const member = (allMembersRes.data || []).find(
            (m) => m.playerIndex === firstQuestionIndex
          );
          updateData.currentPlayerIndex = firstQuestionIndex;
          updateData.currentPlayerName = member
            ? (member.nickName || `玩家${firstQuestionIndex}`)
            : `玩家${firstQuestionIndex}`;
          settledCurrentPlayerIndex = firstQuestionIndex;
        }
        // 回到正常出牌：之后按 getNextPlayerTurn 顺位推进（如 2→3→4→1）
        updateData.partnerGamePhase = 'play';
        updateData.partnerClosingStep = 'rune';
      } else {
        // 全员通过 → 补全符文
        updateData.partnerGamePhase = 'closing';
        updateData.partnerClosingStep = 'rune';
      }
    }

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({ data: updateData });

    return {
      ok: true,
      vote: normalizedVote,
      currentPage: updateData.currentPage || room.currentPage,
      currentPlayerIndex: updateData.currentPlayerIndex != null
        ? updateData.currentPlayerIndex
        : settledCurrentPlayerIndex,
      partnerGamePhase: updateData.partnerGamePhase || room.partnerGamePhase,
      partnerClosingStep: updateData.partnerClosingStep || room.partnerClosingStep,
      closingQuestionPlayers: resolvedQuestionPlayers,
      closingVoteSessionId: nextState.sessionId,
      closingVoteSeq: nextState.seq,
      votedCount,
      totalMembers
    };
  } catch (e) {
    console.error('submitClosingVote error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SUBMIT_ERROR',
      errMsg: e.errMsg || e.message || '提交失败'
    };
  }
};
