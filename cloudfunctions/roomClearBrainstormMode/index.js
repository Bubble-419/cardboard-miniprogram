const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';

/**
 * 房主退出当前游戏模式：
 * - 清除模式 ID 与该模式游戏进度
 * - 保留房间号、房主、成员
 * - 全员回到房间等待态（currentPage = addPlayer）
 */
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
      return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可退出当前游戏模式' };
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
        closingVotes: db.command.set({}),
        closingQuestionPlayers: db.command.set([]),
        closingVoteState: db.command.set({
          sessionId: 0,
          seq: 0,
          brainstormSessionSeq: 0,
          votes: {}
        }),
        partnerRoundSummaries: [],
        partnerCurrentRoundContent: {
          playHistory: [],
          discussionNotes: [],
          playImages: [],
          discussionImages: [],
          images: [],
          voiceLines: [],
          turnRecords: [],
          aiSummary: { status: 'pending' }
        },
        partnerRoundStartedAt: null,
        partnerTurnStartedAt: null,
        partnerClosingCreativePoints: {
          blocks: [],
          texts: [],
          images: []
        },
        selectedBG: db.command.remove(),
        selectedDesignProblem: db.command.remove(),
        spyGame: db.command.remove(),
        spyAssignments: db.command.remove(),
        lastEvent: {
          type: 'mode_cleared',
          at: Date.now(),
          by: currentUserId
        },
        updatedAt: Date.now()
      }
    });

    return { ok: true, currentPage: 'addPlayer', hasSelectedMode: false };
  } catch (e) {
    console.error('roomClearBrainstormMode error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'CLEAR_MODE_ERROR',
      errMsg: e.errMsg || e.message || '退出当前游戏模式失败'
    };
  }
};
