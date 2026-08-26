/** 按游戏模式解析主流程页面路径 */

function getSelectedModeId(fallback) {
  const app = getApp();
  return (app && app.globalData && app.globalData.gameMode)
    || fallback
    || 'halliGalli';
}

function buildSpyPageUrl(pageKey, roomId, query = {}) {
  const roomIdEnc = encodeURIComponent(roomId || '');
  const pathMap = {
    intro: '/packageSpy/pages/modeIndex/index',
    modeIndex: '/packageSpy/pages/modeIndex/index',
    assign: '/packageSpy/pages/assign/index',
    speak: '/packageSpy/pages/speak/index',
    vote: '/packageSpy/pages/vote/index',
    result: '/packageSpy/pages/result/index',
    nextRound: '/packageSpy/pages/nextRound/index',
    settle: '/packageSpy/pages/settle/index'
  };
  let url = `${pathMap[pageKey] || pathMap.intro}?roomId=${roomIdEnc}`;
  Object.keys(query || {}).forEach((key) => {
    if (query[key] == null || query[key] === '') return;
    url += `&${key}=${encodeURIComponent(query[key])}`;
  });
  return url;
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
    if (options.specialMoveUsed) {
      url += '&specialMoveUsed=1';
    }
    if (options.currentRound != null && Number.isFinite(Number(options.currentRound))) {
      url += `&currentRound=${Number(options.currentRound)}`;
    }
    if (options.brainstormSessionSeq != null && Number.isFinite(Number(options.brainstormSessionSeq))) {
      url += `&brainstormSessionSeq=${Number(options.brainstormSessionSeq)}`;
    }
    if (options.fromStatement) {
      url += '&fromStatement=1';
    }
    return url;
  }
  if (modeId === 'spy') {
    return buildSpyPageUrl('speak', roomId);
  }
  return `/pages/main-pages/halliGalli/gamepage/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`;
}

function buildStatementUrl(roomId, currentPlayerIndex, currentPlayerName, options = {}) {
  return buildGamepageUrl(roomId, currentPlayerIndex, 'partner', {
    phase: 'discussion',
    currentRound: options.currentRound
  });
}

function buildSpecialMoveUrl(roomId, currentPlayerIndex) {
  const roomIdEnc = encodeURIComponent(roomId);
  const idx = currentPlayerIndex != null ? currentPlayerIndex : 1;
  return `/pages/main-pages/partnerMode/specialMove/index?roomId=${roomIdEnc}&currentPlayerIndex=${idx}`;
}

function buildClosingStatementUrl(roomId, options = {}) {
  const roomIdEnc = encodeURIComponent(roomId);
  let url = `/pages/main-pages/partnerMode/closingStatement/index?roomId=${roomIdEnc}`;
  if (options.closingVoteSessionId) {
    url += `&closingVoteSessionId=${encodeURIComponent(options.closingVoteSessionId)}`;
  }
  if (options._t) {
    url += `&_t=${encodeURIComponent(options._t)}`;
  }
  return url;
}

function buildClosingEndUrl(roomId) {
  const roomIdEnc = encodeURIComponent(roomId);
  return `/pages/main-pages/partnerMode/closingEnd/index?roomId=${roomIdEnc}`;
}

function buildLeaderboardUrl(roomId, options = {}) {
  const roomIdEnc = encodeURIComponent(roomId || '');
  const from = options.from ? `&from=${encodeURIComponent(options.from)}` : '';
  const sub = options.isSubScreen ? '&isSubScreen=1' : '';
  return `/pages/leaderboard/index?roomId=${roomIdEnc}${from}${sub}`;
}

module.exports = {
  getSelectedModeId,
  buildGamepageUrl,
  buildStatementUrl,
  buildSpecialMoveUrl,
  buildClosingStatementUrl,
  buildClosingEndUrl,
  buildLeaderboardUrl,
  buildSpyPageUrl
};
