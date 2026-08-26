/**
 * 共享云环境下 <image> 不能直接吃 cloud://（尤其他人上传的文件）。
 * 展示优先 downloadFile 成本地路径（不依赖 downloadFile 合法域名），失败再 getTempFileURL。
 * 缓存并在过期/裂图时刷新。
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

function cacheValid(entry) {
  if (!entry || !entry.displayUrl) return false;
  const ttl = entry.via === 'local' ? LOCAL_TTL_MS : HTTPS_TTL_MS;
  return Date.now() - (entry.savedAt || 0) < ttl;
}

function invalidateCloudDisplayUrl(fileID) {
  if (fileID && isCloudFileId(fileID)) cache.delete(fileID);
}

function getSharedCloud() {
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
  const cloud = getSharedCloud();
  if (!cloud || typeof cloud.downloadFile !== 'function') return '';
  const res = await cloud.downloadFile({ fileID });
  return (res && res.tempFilePath) || '';
}

async function fetchHttpsFallback(fileIds) {
  const pending = (fileIds || []).filter(Boolean);
  if (!pending.length) return;
  await waitCloudReady();
  const cloud = getSharedCloud();
  if (!cloud || typeof cloud.getTempFileURL !== 'function') return;
  let fileList = [];
  try {
    const res = await cloud.getTempFileURL({ fileList: pending });
    fileList = (res && res.fileList) || [];
  } catch (e) {
    console.warn('getTempFileURL failed', e);
  }
  fileList.forEach((item) => {
    const id = item && item.fileID;
    if (!id) return;
    const okStatus = item.status == null || Number(item.status) === 0;
    if (okStatus && item.tempFileURL) {
      cache.set(id, {
        displayUrl: item.tempFileURL,
        savedAt: Date.now(),
        via: 'https'
      });
    }
  });
}

async function fetchTempAndCache(fileIds, options = {}) {
  const force = options.force === true;
  const preferLocal = options.preferLocal !== false;
  const pending = fileIds.filter((id) => force || !cacheValid(cache.get(id)));
  if (!pending.length) return;

  const needHttps = [];
  if (preferLocal) {
    for (let i = 0; i < pending.length; i += 1) {
      const id = pending[i];
      try {
        const local = await downloadToLocal(id);
        if (local) {
          cache.set(id, {
            displayUrl: local,
            savedAt: Date.now(),
            via: 'local'
          });
        } else {
          needHttps.push(id);
        }
      } catch (e) {
        console.warn('downloadFile cloud image fail', id, e);
        needHttps.push(id);
      }
    }
    if (needHttps.length) await fetchHttpsFallback(needHttps);
    return;
  }

  await fetchHttpsFallback(pending);
  const stillMissing = pending.filter((id) => !cacheValid(cache.get(id)));
  for (let i = 0; i < stillMissing.length; i += 1) {
    const id = stillMissing[i];
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
      console.warn('downloadFile cloud image fail', id, e);
    }
  }
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
  normalizeWxAvatarUrl,
  invalidateCloudDisplayUrl,
  resolveCloudDisplayUrl,
  resolveCloudDisplayUrls,
  resolveRoundContentMedia,
  collectMediaUrls
};
