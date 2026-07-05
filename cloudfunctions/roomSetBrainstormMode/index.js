const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

/**
 * 房主选择脑暴模式：写入 rooms.selectedModeId / selectedModeTitle / selectedModeDesc
 */
exports.main = async (event, context) => {
  const {
    roomId,
    selectedModeId,
    selectedModeTitle,
    selectedModeDesc
  } = event || {};

  if (!roomId) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'roomId is required' };
  }
  if (!selectedModeId) {
    return { ok: false, errCode: 'INVALID_PARAM', errMsg: 'selectedModeId is required' };
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
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可选择脑暴模式' };
    }

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: {
        selectedModeId,
        selectedModeTitle: selectedModeTitle || '',
        selectedModeDesc: selectedModeDesc || '',
        brainstormSessionSeq: db.command.inc(1),
        currentRound: 1,
        currentPlayerIndex: 1,
        currentPlayerName: '玩家1',
        partnerGamePhase: 'play',
        partnerMasterMode: false,
        partnerClosingStep: 'rune',
        closingVotes: {},
        closingQuestionPlayers: [],
        updatedAt: Date.now()
      }
    });

    return { ok: true };
  } catch (e) {
    console.error('roomSetBrainstormMode error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'SET_MODE_ERROR',
      errMsg: e.errMsg || e.message || '选择脑暴模式失败'
    };
  }
};
