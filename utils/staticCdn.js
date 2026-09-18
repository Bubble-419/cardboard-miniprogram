'use strict';

/**
 * 非必要插图走云存储 HTTPS。对象平铺在 miniprogram-static/ 根下，key 为文件名。
 * 列表内原图由 packOptions.ignore 排除打包。
 * Halli 的小体积 PNG 作为断网降级资源保留在代码包，不列入此处。
 */

const CLOUD_ENV_ID = 'cardboard-miniprogram-6a13aab073';
const CLOUD_BUCKET = `6361-${CLOUD_ENV_ID}-1307472735`;
const CDN_HOST = `https://${CLOUD_BUCKET}.tcb.qcloud.la`;
const STATIC_PREFIX = 'miniprogram-static';

function normalizePackagedPath(packagedPath) {
  return String(packagedPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function staticFileName(packagedPath) {
  const rel = normalizePackagedPath(packagedPath);
  if (!rel) return '';
  return rel.split('/').filter(Boolean).pop();
}

function cloudStaticUrl(packagedPath) {
  const name = staticFileName(packagedPath);
  if (!name) return '';
  return `${CDN_HOST}/${STATIC_PREFIX}/${encodeURIComponent(name)}`;
}

function staticCdnUrl(packagedPath) {
  return cloudStaticUrl(packagedPath);
}

const WAIT_HERO_SRC = staticCdnUrl('assets/subAwait/wait-hero-5a8ea5.webp');
const EMPTY_HISTORY_SRC = staticCdnUrl('assets/home/empty-history-6f27f1.webp');

const PACK_IGNORE_FOR_CDN = [
  { value: 'packageSpy/assets', type: 'folder' },
  { value: 'assets/subAwait/wait-hero-5a8ea5.webp', type: 'file' },
  { value: 'assets/home/empty-history-6f27f1.webp', type: 'file' },
  { value: 'assets/brainstormMode/*.jpg', type: 'glob' },
  { value: 'assets/halliGalli/*.webp', type: 'glob' }
];

module.exports = {
  CLOUD_ENV_ID,
  CLOUD_BUCKET,
  CDN_HOST,
  STATIC_PREFIX,
  WAIT_HERO_SRC,
  EMPTY_HISTORY_SRC,
  PACK_IGNORE_FOR_CDN,
  normalizePackagedPath,
  staticFileName,
  cloudStaticUrl,
  staticCdnUrl
};
