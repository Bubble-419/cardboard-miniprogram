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
 * 全员通过 → 结束过渡页；有人疑问 → 收尾 gamepage 补全符文
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
    if (votedCount >= totalMembers && totalMembers > 0) {
      const hasQuestion = Object.values(closingVotes).some((v) => v === 'question');
      // 结算后立刻清空选票，避免下次进表态页读到残留
      updateData.closingVotes = _.set({});
      updateData.closingVoteState = _.set(buildEmptyClosingVoteState(sessionSeq));
      updateData.partnerMasterMode = false;

      if (hasQuestion) {
        updateData.currentPage = 'gamepage';
        updateData.partnerGamePhase = 'closing';
        updateData.partnerClosingStep = 'rune';
        updateData.closingQuestionPlayers = _.set(resolvedQuestionPlayers);
      } else {
        updateData.currentPage = 'closingEnd';
        updateData.partnerGamePhase = 'closing';
        updateData.closingQuestionPlayers = _.set([]);
        resolvedQuestionPlayers = [];
      }
    }

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({ data: updateData });

    return {
      ok: true,
      vote: normalizedVote,
      currentPage: updateData.currentPage || room.currentPage,
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
