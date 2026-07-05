const STORAGE_PREFIX = 'partnerSpecialMoveUsed_';

function getSpecialMoveTurnKey(sessionSeq, round, playerIndex) {
  return `${sessionSeq != null ? sessionSeq : 0}-${round != null ? round : 1}-${playerIndex != null ? playerIndex : 1}`;
}

function loadSpecialMoveUsedTurnKey(roomId) {
  if (!roomId) return '';
  try {
    return wx.getStorageSync(`${STORAGE_PREFIX}${roomId}`) || '';
  } catch (e) {
    return '';
  }
}

function saveSpecialMoveUsedTurnKey(roomId, turnKey) {
  if (!roomId || !turnKey) return;
  try {
    wx.setStorageSync(`${STORAGE_PREFIX}${roomId}`, turnKey);
  } catch (e) {
    console.warn('saveSpecialMoveUsedTurnKey', e);
  }
}

/** 清除脑暴大富翁（partnerMode）「特殊行动已使用」本地标记 */
function clearPartnerSpecialMoveUsedFlag(roomId) {
  const app = getApp();
  if (!app.globalData) return;
  const flag = app.globalData.partnerSpecialMoveUsedTurn;
  if (!roomId || !flag || flag.roomId === roomId) {
    app.globalData.partnerSpecialMoveUsedTurn = null;
  }
  if (roomId) {
    try {
      wx.removeStorageSync(`${STORAGE_PREFIX}${roomId}`);
    } catch (e) {
      console.warn('clearPartnerSpecialMoveUsedFlag storage', e);
    }
  }
}

function markPartnerSpecialMoveUsed(roomId, playerIndex, round, sessionSeq) {
  const app = getApp();
  if (!app.globalData) app.globalData = {};
  const turnKey = getSpecialMoveTurnKey(sessionSeq, round, playerIndex);
  app.globalData.partnerSpecialMoveUsedTurn = {
    roomId,
    playerIndex,
    round: round != null ? round : 1,
    sessionSeq: sessionSeq != null ? sessionSeq : 0,
    turnKey
  };
  saveSpecialMoveUsedTurnKey(roomId, turnKey);
}

function isSpecialMoveUsedForCurrentTurn(roomId, sessionSeq, round, playerIndex) {
  const turnKey = getSpecialMoveTurnKey(sessionSeq, round, playerIndex);
  return loadSpecialMoveUsedTurnKey(roomId) === turnKey && turnKey !== '';
}

module.exports = {
  getSpecialMoveTurnKey,
  clearPartnerSpecialMoveUsedFlag,
  markPartnerSpecialMoveUsed,
  isSpecialMoveUsedForCurrentTurn
};
