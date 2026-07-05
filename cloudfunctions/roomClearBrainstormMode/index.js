const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

exports.main = async (event, context) => {
  const { roomId } = event || {};

  if (!roomId) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;

  try {
    const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
    if (!roomRes.data || roomRes.data.length === 0) {
      return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
    }

    const room = roomRes.data[0];
    if (!room.creatorId || room.creatorId !== currentUserId) {
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可退出脑暴' };
    }

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: {
        selectedModeId: null,
        selectedModeTitle: null,
        selectedModeDesc: null,
        currentPage: 'addPlayer',
        brainstormProgressPage: null,
        brainstormSessionEnded: false,
        brainstormSessionSeq: db.command.inc(1),
        currentRound: 1,
        currentPlayerIndex: 1,
        currentPlayerName: '玩家1',
        partnerGamePhase: 'play',
        partnerMasterMode: false,
        partnerClosingStep: 'rune',
        closingVotes: {},
        closingQuestionPlayers: [],
        partnerRoundSummaries: [],
        partnerCurrentRoundContent: {
          playHistory: [],
          discussionNotes: [],
          images: [],
          voiceLines: [],
          turnRecords: [],
          aiSummary: { status: 'pending' }
        },
        partnerRoundStartedAt: null,
        updatedAt: Date.now()
      }
    });

    return { ok: true };
  } catch (e) {
    console.error('roomClearBrainstormMode error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'CLEAR_MODE_ERROR',
      errMsg: e.errMsg || e.message || '退出脑暴失败'
    };
  }
};
