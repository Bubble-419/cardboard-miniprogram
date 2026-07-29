/**
 * 词语 → 交互卡 WebP 路径（文件名与词语对应）
 * 游戏分词与牌库浏览共用本模块。
 *
 * 约定（webp/ 目录）：
 * - {词语}3x.webp   → 词语（交互方式卡）
 * - {词语}13x.webp  → 词语1（IxDL 逻辑卡）
 * - 背面3x.webp     → 统一背面
 */

const { WORD_ENTRIES, SPY_WORD_PAIRS } = require('./spyWordPairs');

const ASSET_ROOT = '/assets/spyMode/interactionCards';
const RAW_DIR = `${ASSET_ROOT}/raw`;
const WEBP_DIR = `${ASSET_ROOT}/webp`;
const CARD_BACK_WEBP = `${WEBP_DIR}/背面3x.webp`;

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
 * 牌库收录的全部词语（与 webp 文件名对应，含对局词库外的扩展卡）
 * 对局抽词仍只用 spyWordPairs 中的配对。
 */
const LIBRARY_WORDS = [
  '开关', '单击', '按下', '双击',
  '滑动切换', '轻扫切换', '越界切换',
  '快击', '点击缓冲',
  '拖拽', '甩动', '翻动', '轻拨',
  '持续触发', '长按', '缓冲连发',
  '多点有序点击', '异位连触', '多点同时点击', '多点开关',
  '双按拖拽', '长按拖拽', '点拖互斥',
  '向量菜单', '域控式移动', '整体移动', '方向解耦',
  '滑入停留', '边缘滑入', '环绕旋转',
  '捏合缩放', '捏合解耦', '力速调幅', '动势点选',
  '限位点击', '震动'
];

const ENTRY_BLURB = WORD_ENTRIES.reduce((acc, item) => {
  acc[item.word] = item.blurb || '';
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
    assignedWordSrc: `${WEBP_DIR}/${word}3x.webp`,
    assignedWordFallbackSrc: raw ? `${RAW_DIR}/${raw.method}` : '',
    word1Src: `${WEBP_DIR}/${word}13x.webp`,
    word1FallbackSrc: raw ? `${RAW_DIR}/${raw.ixdl}` : '',
    backSrc: CARD_BACK_WEBP
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
 * 牌库列表项（浏览用，不参与抽卡）
 * @returns {Array<{word:string,blurb:string,coverSrc:string,backSrc:string,assignedWordSrc:string,word1Src:string,inGame:boolean}>}
 */
function listLibraryCards() {
  const gameWordSet = WORD_ENTRIES.reduce((acc, item) => {
    acc[item.word] = true;
    return acc;
  }, {});

  return LIBRARY_WORDS.map((word) => {
    const assets = getWordCardAssets(word);
    return {
      word,
      blurb: ENTRY_BLURB[word] || '',
      coverSrc: assets.assignedWordSrc,
      backSrc: assets.backSrc,
      assignedWordSrc: assets.assignedWordSrc,
      assignedWordFallbackSrc: assets.assignedWordFallbackSrc,
      word1Src: assets.word1Src,
      word1FallbackSrc: assets.word1FallbackSrc,
      inGame: !!gameWordSet[word]
    };
  });
}

module.exports = {
  WORD_RAW_FALLBACK,
  LIBRARY_WORDS,
  getWordCardAssets,
  getLibraryGroupCount,
  getGamePairCount,
  listLibraryCards,
  ASSET_ROOT,
  RAW_DIR,
  WEBP_DIR,
  CARD_BACK_WEBP
};
