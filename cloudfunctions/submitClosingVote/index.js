const cloud = require('wx-server-sdk');
const {
  getBrainstormSessionSeq,
  toPlayerIndex,
  buildEmptyClosingVoteState,
  normalizeClosingVoteState,
  isClosingVoteInitiator,
  applyInitiatorDefaultPass
} = require('./closingVoteState');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

function listVotingSeats(members) {
  const seats = [];
  (members || []).forEach((m) => {
    const idx = toPlayerIndex(m && m.playerIndex);
    if (idx && seats.indexOf(idx) < 0) seats.push(idx);
  });
  return seats;
}

function findMemberBySeat(members, seat) {
  return (members || []).find((m) => toPlayerIndex(m && m.playerIndex) === seat) || null;
}

/** 发起人默认通过，其余座位都有票即可结算 */
function allRequiredVotesIn(votes, seats, initiatorPlayerIndex) {
  const map = votes || {};
  const initiator = toPlayerIndex(initiatorPlayerIndex);
  if (!seats.length) {
    return Object.keys(map).length > 0;
  }
  return seats.every((seat) => {
    if (initiator != null && seat === initiator) return true;
    const vote = map[String(seat)];
    return vote === 'pass' || vote === 'question';
  });
}

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

    const membersRes = await db
      .collection(ROOM_MEMBERS_COLLECTION)
      .where({ roomId })
      .get();
    const roomMembers = (membersRes && membersRes.data) || [];
    const votingSeats = listVotingSeats(roomMembers);
    const totalMembers = votingSeats.length;

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

      if (isClosingVoteInitiator(playerIndex, voteState.initiatorPlayerIndex)) {
        const err = new Error('发起收尾的玩家无需表态');
        err.errCode = 'INITIATOR_EXEMPT';
        throw err;
      }

      const closingVotes = applyInitiatorDefaultPass(
        { ...(voteState.votes || {}) },
        voteState.initiatorPlayerIndex
      );
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
      const shouldSettle = allRequiredVotesIn(
        closingVotes,
        votingSeats,
        voteState.initiatorPlayerIndex
      );

      if (shouldSettle) {
        const hasQuestion = Object.values(closingVotes).some((v) => v === 'question');
        const questionIndices = Object.entries(closingVotes)
          .filter(([, voteValue]) => voteValue === 'question')
          .map(([key]) => parseInt(key, 10))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b);

        updateData.closingVotes = _.set({});
        updateData.closingVoteState = _.set(buildEmptyClosingVoteState(sessionSeq));
        updateData.partnerMasterMode = false;
        updateData.currentPage = 'gamepage';
        updateData.brainstormProgressPage = 'gamepage';
        updateData.revision = _.inc(1);

        const now = Date.now();
        updateData.partnerRoundStartedAt = now;
        updateData.partnerTurnStartedAt = now;

        if (hasQuestion) {
          const firstQuestionIndex = questionIndices[0];
          if (firstQuestionIndex != null) {
            const member = findMemberBySeat(roomMembers, firstQuestionIndex);
            updateData.currentPlayerIndex = firstQuestionIndex;
            updateData.currentPlayerName = member
              ? (member.nickName || `玩家${firstQuestionIndex}`)
              : `玩家${firstQuestionIndex}`;
            settledCurrentPlayerIndex = firstQuestionIndex;
          }
          updateData.closingQuestionPlayers = _.set(questionIndices);
          resolvedQuestionPlayers = questionIndices;
          updateData.partnerGamePhase = 'play';
          updateData.partnerClosingStep = 'rune';
        } else {
          updateData.closingQuestionPlayers = _.set([]);
          resolvedQuestionPlayers = [];
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
        closingVoteSessionId: shouldSettle ? 0 : nextState.sessionId,
        closingVoteSeq: shouldSettle ? 0 : nextState.seq,
        votedCount,
        totalMembers,
        settled: shouldSettle === true
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
