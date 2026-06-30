const STORAGE_PREFIX = 'brainstormProgress_';

function storageKey(roomId) {
  return `${STORAGE_PREFIX}${roomId}`;
}

function saveLocalBrainstormProgress(roomId, currentPage) {
  if (!roomId || !currentPage || currentPage === 'addPlayer') return;
  try {
    wx.setStorageSync(storageKey(roomId), currentPage);
  } catch (e) {
    console.warn('saveLocalBrainstormProgress', e);
  }
}

function getLocalBrainstormProgress(roomId) {
  if (!roomId) return '';
  try {
    return wx.getStorageSync(storageKey(roomId)) || '';
  } catch (e) {
    return '';
  }
}

function clearLocalBrainstormProgress(roomId) {
  if (!roomId) return;
  try {
    wx.removeStorageSync(storageKey(roomId));
  } catch (e) {
    console.warn('clearLocalBrainstormProgress', e);
  }
}

/** 合并云端 roomState 与本地备份，解决大厅页覆盖进度的问题 */
function resolveBrainstormProgress(roomId, roomState, hasSelectedMode) {
  const state = roomState || {};
  let page = state.currentPage || 'addPlayer';
  const local = getLocalBrainstormProgress(roomId);

  if (hasSelectedMode && (page === 'addPlayer' || !page) && local) {
    page = local;
  }

  return { ...state, currentPage: page };
}

module.exports = {
  saveLocalBrainstormProgress,
  getLocalBrainstormProgress,
  clearLocalBrainstormProgress,
  resolveBrainstormProgress
};
