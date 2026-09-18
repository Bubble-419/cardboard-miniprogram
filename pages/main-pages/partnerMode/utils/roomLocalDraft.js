'use strict';

const PREFIX = 'cardboard:room-local-draft:v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function storageKey(kind, scope) {
  const parts = [kind, scope && scope.roomId, scope && scope.sessionId, scope && scope.turnId]
    .map((item) => String(item || '').trim());
  return parts.every(Boolean) ? `${PREFIX}:${parts.map(encodeURIComponent).join(':')}` : '';
}

function readRoomLocalDraft(kind, scope) {
  const key = storageKey(kind, scope);
  if (!key || typeof wx === 'undefined' || typeof wx.getStorageSync !== 'function') return null;
  try {
    const draft = wx.getStorageSync(key);
    if (!draft || typeof draft !== 'object') return null;
    if (!Number.isFinite(draft.updatedAt) || Date.now() - draft.updatedAt > MAX_AGE_MS) {
      wx.removeStorageSync(key);
      return null;
    }
    return draft;
  } catch (error) {
    return null;
  }
}

function writeRoomLocalDraft(kind, scope, value) {
  const key = storageKey(kind, scope);
  if (!key || typeof wx === 'undefined' || typeof wx.setStorageSync !== 'function') return false;
  try {
    wx.setStorageSync(key, { ...(value || {}), updatedAt: Date.now() });
    return true;
  } catch (error) {
    return false;
  }
}

function clearRoomLocalDraft(kind, scope) {
  const key = storageKey(kind, scope);
  if (!key || typeof wx === 'undefined' || typeof wx.removeStorageSync !== 'function') return false;
  try {
    wx.removeStorageSync(key);
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = { storageKey, readRoomLocalDraft, writeRoomLocalDraft, clearRoomLocalDraft };
