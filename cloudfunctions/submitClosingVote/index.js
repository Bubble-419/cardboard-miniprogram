const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_MEMBERS_COLLECTION = 'roomMembers';

/**
 * 收尾阶段表态：每位玩家投「通过」或「存在疑问」
 * 有人投疑问 → 进入收尾 gamepage；全员通过 → 进入结束过渡页
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
    const closingVotes = { ...(room.closingVotes || {}) };
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

    const updateData = {
      closingVotes,
      updatedAt: Date.now()
    };

    if (normalizedVote === 'question') {
      const questionPlayers = Array.isArray(room.closingQuestionPlayers)
        ? [...room.closingQuestionPlayers]
        : [];
      if (!questionPlayers.includes(playerIndex)) {
        questionPlayers.push(playerIndex);
      }
      updateData.closingQuestionPlayers = questionPlayers;
    }

    const votedCount = Object.keys(closingVotes).length;
    if (votedCount >= totalMembers && totalMembers > 0) {
      const hasQuestion = Object.values(closingVotes).some((v) => v === 'question');
      if (hasQuestion) {
        updateData.currentPage = 'gamepage';
        updateData.partnerGamePhase = 'closing';
        updateData.partnerClosingStep = 'rune';
        updateData.partnerMasterMode = false;
      } else {
        updateData.currentPage = 'closingEnd';
        updateData.partnerGamePhase = 'closing';
      }
    }

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({ data: updateData });

    return {
      ok: true,
      vote: normalizedVote,
      currentPage: updateData.currentPage || room.currentPage,
      partnerGamePhase: updateData.partnerGamePhase || room.partnerGamePhase,
      partnerClosingStep: updateData.partnerClosingStep || room.partnerClosingStep,
      closingQuestionPlayers: updateData.closingQuestionPlayers || room.closingQuestionPlayers || [],
      votedCount: Object.keys(closingVotes).length,
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
