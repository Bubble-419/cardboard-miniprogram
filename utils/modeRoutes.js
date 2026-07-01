/** 按游戏模式解析主流程页面路径 */

function getSelectedModeId(fallback) {
  const app = getApp();
  return (app && app.globalData && app.globalData.gameMode)
    || fallback
    || 'halliGalli';
}

function buildGamepageUrl(roomId, currentPlayerIndex, selectedModeId, options = {}) {
  const roomIdEnc = encodeURIComponent(roomId);
  const idx = currentPlayerIndex != null ? currentPlayerIndex : 1;
  const modeId = selectedModeId || getSelectedModeId();
  if (modeId === 'partner') {
    let url = `/pages/main-pages/partnerMode/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`;
    if (options.phase === 'discussion') {
      url += '&phase=discussion';
    }
    if (options.phase === 'closing') {
      url += '&phase=closing';
    }
    if (options.closingStep) {
      url += `&closingStep=${encodeURIComponent(options.closingStep)}`;
    }
    return url;
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

function buildSpecialMoveUrl(roomId, currentPlayerIndex) {
  const roomIdEnc = encodeURIComponent(roomId);
  const idx = currentPlayerIndex != null ? currentPlayerIndex : 1;
  return `/pages/main-pages/partnerMode/specialMove/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`;
}

function buildClosingStatementUrl(roomId) {
  const roomIdEnc = encodeURIComponent(roomId);
  return `/pages/main-pages/partnerMode/closingStatement/index?roomId=${roomIdEnc}`;
}

function buildClosingEndUrl(roomId) {
  const roomIdEnc = encodeURIComponent(roomId);
  return `/pages/main-pages/partnerMode/closingEnd/index?roomId=${roomIdEnc}`;
}

module.exports = {
  getSelectedModeId,
  buildGamepageUrl,
  buildStatementUrl,
  buildSpecialMoveUrl,
  buildClosingStatementUrl,
  buildClosingEndUrl
};
