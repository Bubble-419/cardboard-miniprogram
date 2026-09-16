/**
 * cloud:// 图片先换取临时 HTTPS 地址，仍不可用时下载成本地路径。
 * 客户端两种方式都失败时通过 roomMedia 获取临时地址，并缓存最终结果。
 */

const HTTPS_TTL_MS = 40 * 60 * 1000;
const LOCAL_TTL_MS = 12 * 60 * 60 * 1000;

/** fileID -> { displayUrl, savedAt, via: 'https'|'local' } */
const cache = new Map();

function isCloudFileId(path) {
  return typeof path === 'string' && path.startsWith('cloud://');
}

function isLocalTempPath(path) {
  if (typeof path !== 'string' || !path) return false;
  const lower = path.toLowerCase();
  return (
    lower.startsWith('wxfile://')
    || lower.startsWith('http://tmp/')
    || lower.startsWith('https://tmp/')
    || lower.indexOf('://tmp/') !== -1
  );
}

function isHttpsUrl(path) {
  return typeof path === 'string'
    && (path.startsWith('https://') || path.startsWith('http://'))
    && !isLocalTempPath(path);
}

function isPackagedPath(path) {
  return typeof path === 'string' && path.startsWith('/');
}

/** 微信头像缩略图改原图，避免真机只出一小块/发糊 */
function normalizeWxAvatarUrl(url) {
  if (!isHttpsUrl(url)) return url;
  if (!/qlogo\.cn/i.test(url)) return url;
  return url.replace(/\/\d+(\?|$)/, '/0$1');
}

function isDisplayableImageUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (isCloudFileId(url)) return false;
  return isLocalTempPath(url) || isHttpsUrl(url) || isPackagedPath(url);
}

/** <image src> 可用地址；cloud:// 必须先 resolve，不能直接绑定 */
function sanitizeImageSrc(url, fallback) {
  if (isDisplayableImageUrl(url)) {
    return isHttpsUrl(url) ? normalizeWxAvatarUrl(url) : url;
  }
  if (isDisplayableImageUrl(fallback)) return fallback;
  return '';
}

function cacheValid(entry) {
  if (!entry || !entry.displayUrl) return false;
  const ttl = entry.via === 'local' ? LOCAL_TTL_MS : HTTPS_TTL_MS;
  return Date.now() - (entry.savedAt || 0) < ttl;
}

function invalidateCloudDisplayUrl(fileID) {
  if (fileID && isCloudFileId(fileID)) cache.delete(fileID);
}

function getCloudRuntime() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.cloud) return app.globalData.cloud;
  } catch (e) {
    // ignore
  }
  return wx.cloud;
}

async function waitCloudReady() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.cloudReady) {
      await app.globalData.cloudReady;
    }
  } catch (e) {
    console.warn('waitCloudReady', e);
  }
}

function collectCloudIds(urls) {
  const ids = [];
  (urls || []).forEach((url) => {
    if (isCloudFileId(url) && ids.indexOf(url) < 0) ids.push(url);
  });
  return ids;
}

async function downloadToLocal(fileID) {
  await waitCloudReady();
  const cloud = getCloudRuntime();
  if (!cloud || typeof cloud.downloadFile !== 'function') return '';
  const res = await cloud.downloadFile({ fileID });
  return (res && res.tempFilePath) || '';
}

function cacheHttps(fileID, tempFileURL) {
  if (!fileID || !tempFileURL) return;
  cache.set(fileID, {
    displayUrl: tempFileURL,
    savedAt: Date.now(),
    via: 'https'
  });
}

function applyTempFileList(requestedIds, fileList) {
  (fileList || []).forEach((item, index) => {
    const requestedId = requestedIds[index];
    const responseId = item && item.fileID;
    const okStatus = item && (item.status == null || Number(item.status) === 0);
    const tempFileURL = item && item.tempFileURL;
    if (okStatus && tempFileURL) {
      if (requestedId) cacheHttps(requestedId, tempFileURL);
      if (responseId && responseId !== requestedId) cacheHttps(responseId, tempFileURL);
      return;
    }
    console.warn(
      'getTempFileURL item fail',
      requestedId || responseId,
      item && (item.errMsg || item.status)
    );
  });
}

function toTempFileListArg(fileIds) {
  return fileIds.map((fileID) => ({ fileID, maxAge: 7200 }));
}

async function fetchHttpsFallback(fileIds) {
  const pending = (fileIds || []).filter((id) => id && !cacheValid(cache.get(id)));
  if (!pending.length) return;
  await waitCloudReady();
  const cloud = getCloudRuntime();
  if (!cloud || typeof cloud.getTempFileURL !== 'function') return;
  let fileList = [];
  try {
    const res = await cloud.getTempFileURL({ fileList: toTempFileListArg(pending) });
    fileList = (res && res.fileList) || [];
  } catch (e) {
    console.warn('getTempFileURL failed', e);
  }
  applyTempFileList(pending, fileList);
}

async function fetchHttpsViaCloudFunction(fileIds) {
  const pending = (fileIds || []).filter((id) => id && !cacheValid(cache.get(id)));
  if (!pending.length) return;
  await waitCloudReady();
  let fileList = [];
  try {
    const { callCloudFunction } = require('./cloudApi');
    const { getRoomRequestContext } = require('../modules/room-session/index');
    const res = await callCloudFunction('roomMedia', {
      action: 'tempUrls',
      fileList: pending,
      clientContext: getRoomRequestContext()
    });
    const result = res && (res.result || res);
    fileList = (result && result.fileList) || [];
  } catch (e) {
    console.warn('cloudFunction tempUrls failed', e);
    return;
  }
  applyTempFileList(pending, fileList);
}

async function fetchTempAndCache(fileIds, options = {}) {
  const force = options.force === true;
  const preferLocal = options.preferLocal !== false;
  const pending = fileIds.filter((id) => force || !cacheValid(cache.get(id)));
  if (!pending.length) return;

  await fetchHttpsFallback(pending);

  const localTargets = pending.filter((id) => {
    if (preferLocal && force) return true;
    return !cacheValid(cache.get(id));
  });
  for (let i = 0; i < localTargets.length; i += 1) {
    const id = localTargets[i];
    try {
      const local = await downloadToLocal(id);
      if (local) {
        cache.set(id, {
          displayUrl: local,
          savedAt: Date.now(),
          via: 'local'
        });
      }
    } catch (e) {
      if (!cacheValid(cache.get(id))) {
        console.warn('downloadFile cloud image fail', id, e);
      }
    }
  }

  const stillMissing = pending.filter((id) => !cacheValid(cache.get(id)));
  if (stillMissing.length) await fetchHttpsViaCloudFunction(stillMissing);
}

/**
 * 将 cloud:// / https / 本地路径转为 <image> 可用地址，顺序与输入一致。
 * @param {string[]} urls
 * @param {{ force?: boolean }} [options]
 */
async function resolveCloudDisplayUrls(urls, options = {}) {
  const list = Array.isArray(urls) ? urls : [];
  const ids = collectCloudIds(list);
  if (ids.length) {
    await fetchTempAndCache(ids, options);
  }
  return list.map((url) => {
    if (!url || typeof url !== 'string') return '';
    if (isPackagedPath(url) || isLocalTempPath(url)) return url;
    if (isCloudFileId(url)) {
      const entry = cache.get(url);
      const display = entry && entry.displayUrl;
      return isDisplayableImageUrl(display) ? display : '';
    }
    if (isHttpsUrl(url)) return normalizeWxAvatarUrl(url);
    return '';
  });
}

async function resolveCloudDisplayUrl(url, options) {
  const [out] = await resolveCloudDisplayUrls([url], options);
  return out || '';
}

function remapImageBlocks(blocks, urlMap) {
  return (blocks || []).map((b) => {
    if (!b || b.type !== 'image' || !b.url) return b;
    const next = urlMap[b.url];
    if (!next || next === b.url) return b;
    return { ...b, url: next, fileID: isCloudFileId(b.url) ? b.url : b.fileID };
  });
}

/** 收集 blocks / 字符串数组里的 cloud:// */
function collectMediaUrls(roundContent) {
  const urls = [];
  const push = (u) => {
    if (typeof u === 'string' && u && urls.indexOf(u) < 0) urls.push(u);
  };
  const src = roundContent || {};
  (src.playImages || []).forEach(push);
  (src.discussionImages || []).forEach(push);
  (src.images || []).forEach(push);
  const walkBlocks = (blocks) => {
    (blocks || []).forEach((b) => {
      if (b && b.type === 'image') push(b.url);
    });
  };
  walkBlocks(src.playBlocks);
  walkBlocks(src.discussionBlocks);
  if (src.privateNote) {
    (src.privateNote.playImages || []).forEach(push);
    (src.privateNote.discussionImages || []).forEach(push);
    walkBlocks(src.privateNote.playBlocks);
    walkBlocks(src.privateNote.discussionBlocks);
  }
  return urls;
}

async function resolveRoundContentMedia(roundContent, options) {
  const src = roundContent || {};
  const urls = collectMediaUrls(src);
  if (!urls.length) return src;
  const resolved = await resolveCloudDisplayUrls(urls, options);
  const urlMap = {};
  urls.forEach((u, i) => {
    if (resolved[i]) urlMap[u] = resolved[i];
  });
  const mapList = (arr) => (arr || []).map((u) => {
    if (urlMap[u]) return urlMap[u];
    return isCloudFileId(u) ? '' : u;
  });
  const note = src.privateNote;
  return {
    ...src,
    playImages: mapList(src.playImages),
    discussionImages: mapList(src.discussionImages),
    images: mapList(src.images),
    playBlocks: remapImageBlocks(src.playBlocks, urlMap),
    discussionBlocks: remapImageBlocks(src.discussionBlocks, urlMap),
    privateNote: note
      ? {
        ...note,
        playImages: mapList(note.playImages),
        discussionImages: mapList(note.discussionImages),
        playBlocks: remapImageBlocks(note.playBlocks, urlMap),
        discussionBlocks: remapImageBlocks(note.discussionBlocks, urlMap)
      }
      : note
  };
}

module.exports = {
  isCloudFileId,
  isDisplayableImageUrl,
  sanitizeImageSrc,
  normalizeWxAvatarUrl,
  invalidateCloudDisplayUrl,
  resolveCloudDisplayUrl,
  resolveCloudDisplayUrls,
  resolveRoundContentMedia,
  collectMediaUrls
};
