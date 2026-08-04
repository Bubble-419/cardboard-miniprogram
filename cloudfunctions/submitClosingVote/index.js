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
 * 事务内重读并写入，避免并发投票互相覆盖
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
    const voteKey = String(playerIndex);

    const membersCountRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .count();
    const totalMembers = (membersCountRes && membersCountRes.total) || 0;

    const result = await db.runTransaction(async (transaction) => {
      const roomRes = await transaction
        .collection(ROOMS_COLLECTION)
        .where({ roomId })
        .limit(1)
        .get();
      const room = roomRes.data && roomRes.data[0];
      if (!room) {
        const err = new Error('房间不存在');
        err.errCode = 'ROOM_NOT_FOUND';
        throw err;
      }

      const page = (room.currentPage || '').toLowerCase();
      if (page !== 'closingstatement') {
        const err = new Error('当前不在收尾表态阶段');
        err.errCode = 'NOT_IN_CLOSING_VOTE';
        throw err;
      }

      const sessionSeq = getBrainstormSessionSeq(room);
      const voteState = normalizeClosingVoteState(room.closingVoteState, sessionSeq);
      if (!voteState) {
        const err = new Error('表态会话已失效，请重新进入收尾阶段');
        err.errCode = 'VOTE_SESSION_INVALID';
        throw err;
      }

      const closingVotes = { ...(voteState.votes || {}) };
      if (closingVotes[voteKey]) {
        const err = new Error('您已表态');
        err.errCode = 'ALREADY_VOTED';
        throw err;
      }

      closingVotes[voteKey] = normalizedVote;
      const nextState = {
        ...voteState,
        votes: closingVotes
      };

      const updateData = {
        closingVotes: _.set(closingVotes),
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
            const allMembersRes = await transaction
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
          updateData.partnerGamePhase = 'play';
          updateData.partnerClosingStep = 'rune';
        } else {
          updateData.partnerGamePhase = 'closing';
          updateData.partnerClosingStep = 'rune';
        }
      }

      await transaction.collection(ROOMS_COLLECTION).doc(room._id).update({ data: updateData });

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
    });

    return result;
  } catch (e) {
    console.error('submitClosingVote error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SUBMIT_ERROR',
      errMsg: e.errMsg || e.message || '提交失败'
    };
  }
};
