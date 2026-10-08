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

// 2×2 行优先：左上延时、右上位置、左下属性类型、右下稳定态
const CLOSING_RUNE_CARDS = Object.freeze([
  {
    id: 'delay',
    label: '延时符文',
    src: '/assets/partnerMode/closing-runes/delay-absolute.jpg'
  },
  {
    id: 'position',
    label: '位置符文',
    src: '/assets/partnerMode/closing-runes/position-slot.jpg'
  },
  {
    id: 'attribute',
    label: '属性类型符文',
    src: '/assets/partnerMode/closing-runes/attribute-type.jpg'
  },
  {
    id: 'stable',
    label: '稳定态符文',
    src: '/assets/partnerMode/closing-runes/stable-assign.jpg'
  }
]);

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
  CLOSING_RUNE_CARDS,
  PACK_IGNORE_FOR_CDN,
  normalizePackagedPath,
  staticFileName,
  cloudStaticUrl,
  staticCdnUrl
};
