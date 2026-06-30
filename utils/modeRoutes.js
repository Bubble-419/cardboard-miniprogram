/** 按游戏模式解析主流程页面路径 */

function getSelectedModeId(fallback) {
  const app = getApp();
  return (app && app.globalData && app.globalData.gameMode)
    || fallback
    || 'halliGalli';
}

function buildGamepageUrl(roomId, currentPlayerIndex, selectedModeId) {
  const roomIdEnc = encodeURIComponent(roomId);
  const idx = currentPlayerIndex != null ? currentPlayerIndex : 1;
  const modeId = selectedModeId || getSelectedModeId();
  if (modeId === 'partner') {
    return `/pages/main-pages/partnerMode/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`;
  }
  return `/pages/main-pages/halliGalli/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`;
}

function buildStatementUrl(roomId, currentPlayerIndex, currentPlayerName, options = {}) {
  const roomIdEnc = encodeURIComponent(roomId);
  const idx = currentPlayerIndex != null ? currentPlayerIndex : 1;
  const name = encodeURIComponent(currentPlayerName || `玩家${idx}`);
  let url = `/pages/main-pages/partnerMode/statement/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}&currentPlayerName=${name}`;
  if (options.isSubScreen) url += '&isSubScreen=1';
  if (options.isWaiting) url += '&isWaiting=1';
  return url;
}

function buildSpecialMoveUrl(roomId) {
  return `/pages/main-pages/partnerMode/specialMove/index?roomId=${encodeURIComponent(roomId)}`;
}

module.exports = {
  getSelectedModeId,
  buildGamepageUrl,
  buildStatementUrl,
  buildSpecialMoveUrl
};
