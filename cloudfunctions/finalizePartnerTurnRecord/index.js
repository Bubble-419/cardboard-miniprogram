const cloud = require('wx-server-sdk');
const {
  normalizePartnerRoundContent,
  getStatementLabel
} = require('./partnerRoundContent');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const ROOMS_COLLECTION = 'rooms';
const ROOM_SCORES_COLLECTION = 'roomScores';

async function assertHost(roomId, userId) {
  const roomRes = await db.collection(ROOMS_COLLECTION).where({ roomId }).limit(1).get();
  if (!roomRes.data || !roomRes.data.length) {
    return { ok: false, errCode: 'ROOM_NOT_FOUND', errMsg: '房间不存在' };
  }
  const room = roomRes.data[0];
  const creatorId = room.creatorId || room.creator_id;
  if (!creatorId || String(creatorId) !== String(userId)) {
    return { ok: false, errCode: 'NO_PERMISSION', errMsg: '仅房主可归档表态记录' };
  }
  return { ok: true, room };
}

exports.main = async (event) => {
  const {
    roomId,
    playerIndex,
    playerName,
    statementResult
  } = event || {};

  if (!roomId || playerIndex == null || !statementResult) {
    return {
      ok: false,
      errCode: 'INVALID_PARAM',
      errMsg: 'roomId、playerIndex、statementResult 必填'
    };
  }

  const wxContext = cloud.getWXContext();
  const currentUserId = wxContext.FROM_OPENID || wxContext.OPENID;
  if (!currentUserId) {
    return { ok: false, errCode: 'NO_OPENID', errMsg: '未登录' };
  }

  try {
    const hostCheck = await assertHost(roomId, currentUserId);
    if (!hostCheck.ok) return hostCheck;
    const room = hostCheck.room;
    const currentRound = room.currentRound != null ? room.currentRound : 1;
    const idx = parseInt(playerIndex, 10);

    const scoresRes = await db.collection(ROOM_SCORES_COLLECTION)
      .where({ roomId, currentPlayerIndex: idx, round: currentRound })
      .get();
    const scoreRows = scoresRes.data || [];
    const scoreSum = scoreRows.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
    const scoredCount = scoreRows.length;
    const avgScore = scoredCount > 0
      ? Math.round((scoreSum / scoredCount) * 10) / 10
      : null;

    const content = normalizePartnerRoundContent(room.partnerCurrentRoundContent);
    const turnRecord = {
      avgScore,
      scoredCount,
      statementResult,
      statementLabel: getStatementLabel(statementResult),
      recordedAt: Date.now(),
      playerIndex: idx
    };

    const existingIndex = content.turnRecords.findIndex(
      (item) => item.playerIndex === idx
    );
    if (existingIndex >= 0) {
      content.turnRecords[existingIndex] = turnRecord;
    } else {
      content.turnRecords.push(turnRecord);
    }

    await db.collection(ROOMS_COLLECTION).where({ roomId }).update({
      data: {
        partnerCurrentRoundContent: content,
        updatedAt: Date.now()
      }
    });

    return { ok: true, turnRecord, turnRecords: content.turnRecords };
  } catch (e) {
    console.error('finalizePartnerTurnRecord error', e);
    return {
      ok: false,
      errCode: e.errCode || e.code || 'FINALIZE_TURN_ERROR',
      errMsg: e.errMsg || e.message || '归档表态记录失败'
    };
  }
};
