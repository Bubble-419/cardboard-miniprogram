'use strict';

const STORAGE_KEY = 'spyCardLocale';
let current = 'zh';

function getSpyCardLocale() {
  return current;
}

function readSpyCardLocale() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      const stored = wx.getStorageSync(STORAGE_KEY);
      if (stored === 'en' || stored === 'zh') current = stored;
    }
  } catch (e) {
    // 存储不可用时沿用本次进程里的选择
  }
  return current;
}

function setSpyCardLocale(locale) {
  current = locale === 'en' ? 'en' : 'zh';
  try {
    if (typeof wx !== 'undefined' && typeof wx.setStorageSync === 'function') {
      wx.setStorageSync(STORAGE_KEY, current);
    }
  } catch (e) {
    // 写入失败不影响当前页面立刻换图
  }
  return current;
}

module.exports = {
  getSpyCardLocale,
  readSpyCardLocale,
  setSpyCardLocale
};
