const STORAGE_PREFIX = 'partnerPrivateNotes_';

function storageKey(roomId, sessionSeq) {
  const seq = sessionSeq != null ? sessionSeq : 0;
  return `${STORAGE_PREFIX}${roomId}_${seq}`;
}

function normalizeNote(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const legacyImages = Array.isArray(src.images) ? src.images.filter(Boolean) : [];
  const playImages = Array.isArray(src.playImages) ? src.playImages.filter(Boolean) : [];
  const discussionImages = Array.isArray(src.discussionImages)
    ? src.discussionImages.filter(Boolean)
    : [];
  return {
    text: typeof src.text === 'string' ? src.text : '',
    photos: Array.isArray(src.photos) ? src.photos.filter(Boolean) : [],
    // 当前轮出牌/讨论卡插入：仅本机可见
    playHistory: Array.isArray(src.playHistory) ? src.playHistory.filter((t) => typeof t === 'string') : [],
    discussionNotes: Array.isArray(src.discussionNotes)
      ? src.discussionNotes.filter((t) => typeof t === 'string')
      : [],
    // 兼容旧数据：未分阶段的 images 归入出牌解释
    playImages: playImages.length ? playImages : legacyImages,
    discussionImages,
    images: legacyImages,
    updatedAt: src.updatedAt || 0
  };
}

function loadAllPrivateNotes(roomId, sessionSeq) {
  if (!roomId) return {};
  try {
    const raw = wx.getStorageSync(storageKey(roomId, sessionSeq));
    if (!raw || typeof raw !== 'object') return {};
    const map = {};
    Object.keys(raw).forEach((roundKey) => {
      map[roundKey] = normalizeNote(raw[roundKey]);
    });
    return map;
  } catch (e) {
    console.warn('loadAllPrivateNotes', e);
    return {};
  }
}

function loadPrivateRoundNote(roomId, sessionSeq, round) {
  const all = loadAllPrivateNotes(roomId, sessionSeq);
  return normalizeNote(all[String(round)]);
}

function savePrivateRoundNote(roomId, sessionSeq, round, note) {
  if (!roomId || round == null) return false;
  const key = storageKey(roomId, sessionSeq);
  const all = loadAllPrivateNotes(roomId, sessionSeq);
  const next = normalizeNote(note);
  next.updatedAt = Date.now();
  all[String(round)] = next;
  try {
    wx.setStorageSync(key, all);
    return true;
  } catch (e) {
    console.warn('savePrivateRoundNote', e);
    return false;
  }
}

function clearPrivateNotesForRoom(roomId, sessionSeq) {
  if (!roomId) return;
  try {
    wx.removeStorageSync(storageKey(roomId, sessionSeq));
  } catch (e) {
    console.warn('clearPrivateNotesForRoom', e);
  }
}

function attachPrivateNotesToSummaries(summaries, roomId, sessionSeq) {
  const all = loadAllPrivateNotes(roomId, sessionSeq);
  return (summaries || []).map((item) => {
    const round = item && item.round != null ? item.round : 0;
    const note = normalizeNote(all[String(round)]);
    return {
      ...item,
      privateNote: note
    };
  });
}

function persistTempPhoto(tempFilePath) {
  return new Promise((resolve, reject) => {
    if (!tempFilePath) {
      reject(new Error('empty path'));
      return;
    }
    wx.saveFile({
      tempFilePath,
      success: (res) => resolve(res.savedFilePath || tempFilePath),
      fail: () => resolve(tempFilePath)
    });
  });
}

module.exports = {
  loadAllPrivateNotes,
  loadPrivateRoundNote,
  savePrivateRoundNote,
  clearPrivateNotesForRoom,
  attachPrivateNotesToSummaries,
  persistTempPhoto
};
