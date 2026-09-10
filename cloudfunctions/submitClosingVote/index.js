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

/** 云库 update/_.set 不能带 null/undefined，否则整次提交会失败 */
function omitNulls(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== null && item !== undefined)
      .map((item) => omitNulls(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((key) => {
      const item = value[key];
      if (item === null || item === undefined) return;
      out[key] = omitNulls(item);
    });
    return out;
  }
  return value;
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
    const playerIndex = toPlayerIndex(myMember.playerIndex);
    if (playerIndex == null) {
      return { ok: false, errCode: 'NO_SEAT', errMsg: '未分配座位' };
    }
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
      const nextState = omitNulls({
        ...voteState,
        initiatorPlayerIndex: voteState.initiatorPlayerIndex || 0,
        votes: closingVotes
      });

      const updateData = {
        closingVotes: _.set(closingVotes),
        closingVoteState: _.set(nextState),
        updatedAt: Date.now()
      };

      let resolvedQuestionPlayers = (Array.isArray(room.closingQuestionPlayers)
        ? room.closingQuestionPlayers
        : []
      )
        .map((seat) => toPlayerIndex(seat))
        .filter((seat) => seat != null);
      if (
        normalizedVote === 'question'
        && resolvedQuestionPlayers.indexOf(playerIndex) < 0
      ) {
        resolvedQuestionPlayers.push(playerIndex);
        updateData.closingQuestionPlayers = _.set(resolvedQuestionPlayers);
      }

      const votedCount = Object.keys(closingVotes).length;
      let settledCurrentPlayerIndex = room.currentPlayerIndex != null ? room.currentPlayerIndex : 1;
      // 发起人已在开局时写入默认通过，这里仍按全员票数结算
      const shouldSettle = totalMembers > 0 && votedCount >= totalMembers;

      if (shouldSettle) {
        const hasQuestion = Object.values(closingVotes).some((v) => v === 'question');
        const questionIndices = Object.entries(closingVotes)
          .filter(([, voteValue]) => voteValue === 'question')
          .map(([key]) => toPlayerIndex(key))
          .filter((seat) => seat != null)
          .sort((a, b) => a - b);

        const prevRev = Number(room.revision);
        updateData.closingVotes = _.set({});
        updateData.closingVoteState = _.set(omitNulls(buildEmptyClosingVoteState(sessionSeq)));
        updateData.partnerMasterMode = false;
        updateData.currentPage = 'gamepage';
        updateData.brainstormProgressPage = 'gamepage';
        updateData.revision = (Number.isFinite(prevRev) ? prevRev : 0) + 1;

        const now = Date.now();
        updateData.partnerRoundStartedAt = now;
        updateData.partnerTurnStartedAt = now;

        if (hasQuestion) {
          const firstQuestionIndex = questionIndices[0];
          if (firstQuestionIndex != null) {
            const member = findMemberBySeat(roomMembers, firstQuestionIndex);
            const playerName = member && member.nickName
              ? String(member.nickName)
              : `玩家${firstQuestionIndex}`;
            updateData.currentPlayerIndex = firstQuestionIndex;
            updateData.currentPlayerName = playerName;
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
    const err = e || {};
    return {
      ok: false,
      errCode: err.errCode || err.code || 'SUBMIT_ERROR',
      errMsg: err.errMsg || err.message || '提交失败'
    };
  }
};
