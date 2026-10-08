/**
 * 词语 → 交互卡 WebP（文件名与词语对应）
 * 游戏分词与牌库浏览共用本模块。卡片文件在仓库中，打包时忽略，运行时走 CDN。
 *
 * 约定（webp/ 目录）：
 * - {词语}3x.webp   → 词语（交互方式卡）
 * - {词语}13x.webp  → 词语1（IxDL 逻辑卡）
 * - 背面3x.webp     → 统一背面
 */

const { WORD_ENTRIES, SPY_WORD_PAIRS } = require('./spyWordPairs');
const { staticCdnUrl } = require('../../utils/staticCdn');

const ASSET_ROOT = 'packageSpy/assets/interactionCards';
const RAW_DIR = `${ASSET_ROOT}/raw`;
const WEBP_DIR = `${ASSET_ROOT}/webp`;
const CARD_BACK_WEBP = staticCdnUrl(`${WEBP_DIR}/背面3x.webp`);

/** 旧 PNG 编号映射，仅作 WebP 缺失时的回退（游戏词） */
const WORD_RAW_FALLBACK = {
  开关: { method: 'card-034.png', ixdl: 'card-036.png' },
  单击: { method: 'card-009.png', ixdl: 'card-010.png' },
  按下: { method: 'card-001.png', ixdl: 'card-002.png' },
  滑动切换: { method: 'card-027.png', ixdl: 'card-028.png' },
  轻扫切换: { method: 'card-059.png', ixdl: 'card-046.png' },
  越界切换: { method: 'card-066.png', ixdl: 'card-065.png' },
  快击: { method: 'card-037.png', ixdl: 'card-038.png' },
  点击缓冲: { method: 'card-011.png', ixdl: 'card-012.png' },
  拖拽: { method: 'card-056.png', ixdl: 'card-055.png' },
  甩动: { method: 'card-052.png', ixdl: 'card-047.png' },
  翻动: { method: 'card-022.png', ixdl: 'card-023.png' },
  持续触发: { method: 'card-007.png', ixdl: 'card-008.png' },
  长按: { method: 'card-069.png', ixdl: 'card-067.png' },
  缓冲连发: { method: 'card-032.png', ixdl: 'card-035.png' },
  多点有序点击: { method: 'card-019.png', ixdl: 'card-020.png' },
  异位连触: { method: 'card-061.png', ixdl: 'card-024.png' }
};

/**
 * 牌库四类分组（编号 01–36）。
 * word：资源文件名用词；displayName / blurbWord 可选，用于展示别名与简介来源。
 */
const LIBRARY_CATEGORIES = [
  {
    id: 'click',
    title: '点击类',
    cards: [
      { no: '01', word: '开关' },
      { no: '02', word: '单击' },
      { no: '03', word: '按下' },
      { no: '04', word: '持续触发' },
      { no: '05', word: '长按' },
      { no: '06', word: '双击' },
      { no: '07', word: '多点开关' },
      { no: '08', word: '多点有序点击' },
      { no: '09', word: '多点同时点击' }
    ]
  },
  {
    id: 'motion',
    title: '位移类',
    cards: [
      { no: '10', word: '拖拽' },
      { no: '11', word: '甩动' },
      { no: '12', word: '翻动' },
      { no: '13', word: '滑动切换' },
      { no: '14', word: '越界切换' },
      // 资源文件名为「震动」；对局词库条目为「晃动」
      { no: '15', word: '震动', displayName: '晃动/震动', blurbWord: '晃动' },
      { no: '16', word: '捏合缩放' },
      { no: '17', word: '环绕旋转' },
      { no: '18', word: '整体移动' }
    ]
  },
  {
    id: 'multi',
    title: '多维协同',
    cards: [
      { no: '19', word: '限位点击' },
      { no: '20', word: '长按拖拽' },
      { no: '21', word: '双按拖拽' },
      { no: '22', word: '轻扫切换' },
      { no: '23', word: '域控式移动' },
      { no: '24', word: '力速调幅' },
      { no: '25', word: '异位连触' },
      { no: '26', word: '向量菜单' },
      { no: '27', word: '动势点选' }
    ]
  },
  {
    id: 'conflict',
    title: '冲突调和',
    cards: [
      { no: '28', word: '快击' },
      { no: '29', word: '点击缓冲' },
      { no: '30', word: '缓冲连发' },
      { no: '31', word: '边缘滑入' },
      { no: '32', word: '滑入停留' },
      { no: '33', word: '方向解耦' },
      { no: '34', word: '轻拨' },
      { no: '35', word: '点拖互斥' },
      { no: '36', word: '捏合解耦' }
    ]
  }
];

const LIBRARY_WORDS = LIBRARY_CATEGORIES.reduce(
  (all, category) => all.concat(category.cards.map((item) => item.word)),
  []
);

const ENTRY_BLURB = WORD_ENTRIES.reduce((acc, item) => {
  acc[item.word] = item.blurb || '';
  return acc;
}, {});

const GAME_WORD_SET = WORD_ENTRIES.reduce((acc, item) => {
  acc[item.word] = true;
  return acc;
}, {});

function getWordCardAssets(word) {
  if (!word) {
    return {
      assignedWordSrc: '',
      assignedWordFallbackSrc: '',
      word1Src: '',
      word1FallbackSrc: '',
      backSrc: CARD_BACK_WEBP
    };
  }

  const raw = WORD_RAW_FALLBACK[word];
  return {
    assignedWordSrc: staticCdnUrl(`${WEBP_DIR}/${word}3x.webp`),
    assignedWordFallbackSrc: raw ? staticCdnUrl(`${RAW_DIR}/${raw.method}`) : '',
    word1Src: staticCdnUrl(`${WEBP_DIR}/${word}13x.webp`),
    word1FallbackSrc: raw ? staticCdnUrl(`${RAW_DIR}/${raw.ixdl}`) : '',
    backSrc: CARD_BACK_WEBP
  };
}

function buildLibraryCard(item) {
  const word = item.word;
  const assets = getWordCardAssets(word);
  const blurbKey = item.blurbWord || word;
  return {
    no: item.no,
    word,
    displayName: item.displayName || word,
    blurb: ENTRY_BLURB[blurbKey] || ENTRY_BLURB[word] || '',
    coverSrc: assets.assignedWordSrc,
    backSrc: assets.backSrc,
    assignedWordSrc: assets.assignedWordSrc,
    assignedWordFallbackSrc: assets.assignedWordFallbackSrc,
    word1Src: assets.word1Src,
    word1FallbackSrc: assets.word1FallbackSrc,
    inGame: !!(GAME_WORD_SET[blurbKey] || GAME_WORD_SET[word])
  };
}

/** 牌库组数：每词含「词语 + 词语1」视为 1 组 */
function getLibraryGroupCount() {
  return LIBRARY_WORDS.length;
}

/** 对局可用词对数量 */
function getGamePairCount() {
  return (SPY_WORD_PAIRS && SPY_WORD_PAIRS.length) || 0;
}

/**
 * 牌库分类列表（浏览用，不参与抽卡）
 * @returns {Array<{id:string,title:string,count:number,cards:Array}>}
 */
function listLibraryCategories() {
  return LIBRARY_CATEGORIES.map((category) => ({
    id: category.id,
    title: category.title,
    count: category.cards.length,
    cards: category.cards.map(buildLibraryCard)
  }));
}

/**
 * 牌库扁平列表（兼容发言页等查找）
 * @returns {Array}
 */
function listLibraryCards() {
  return listLibraryCategories().reduce((all, category) => all.concat(category.cards), []);
}

module.exports = {
  WORD_RAW_FALLBACK,
  LIBRARY_CATEGORIES,
  LIBRARY_WORDS,
  getWordCardAssets,
  getLibraryGroupCount,
  getGamePairCount,
  listLibraryCategories,
  listLibraryCards,
  ASSET_ROOT,
  RAW_DIR,
  WEBP_DIR,
  CARD_BACK_WEBP
};
