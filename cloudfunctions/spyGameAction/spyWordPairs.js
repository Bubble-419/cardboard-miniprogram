/**
 * 谁是卧底词库：来自《交互机制的对比》易混淆词对
 * 每项含机制简述，供发言页「交互方式卡」展示
 */

const WORD_ENTRIES = [
  { word: '开关', blurb: '控件 0/1 状态直接对应物件状态，状态不变则物件不变，不关心动作过程。' },
  { word: '单击', blurb: '需完成按下再抬起（0→1→0）才触发一次，不留存状态，抬起时生效。' },
  { word: '按下', blurb: '捕捉从 0→1 的瞬时变化即触发，不要求抬起，也不留存状态。' },
  { word: '滑动切换', blurb: '位移达到阈值立刻跳转状态，无需释放，对象不全程实时跟随。' },
  { word: '轻扫切换', blurb: '位移达标且松手释放后才切换，支持中途反向取消，强调确认与容错。' },
  { word: '越界切换', blurb: '以穿过边界线为唯一判定，划过瞬间触发，不看总位移、不需要释放。' },
  { word: '快击', blurb: '调和单击与长按：快速按下并抬起判单击，按住过久则判长按。' },
  { word: '点击缓冲', blurb: '调和单击与双击：首次点击后延迟等待，窗口内有第二击则双击，否则单击。' },
  { word: '拖拽', blurb: '仅由位置驱动，实时跟随、无惯性、无锚点归位，松手即停。' },
  { word: '甩动', blurb: '位置加释放速度驱动，释放后惯性滑行，终点不固定。' },
  { word: '翻动', blurb: '位移可跟随，释放后强制吸附到预设锚点，强调结果确定。' },
  { word: '持续触发', blurb: '按住即开始，以固定间隔匀速连发，无延时门槛。' },
  { word: '长按', blurb: '按住超过时间阈值才触发一次，不连发，用延迟降低误触。' },
  { word: '缓冲连发', blurb: '按下先立即触发一次，缓冲等待后再进入连续连发。' },
  { word: '多点有序点击', blurb: '按预设先后顺序点击多个点位即可，不强调点位相对方位。' },
  { word: '异位连触', blurb: '以前一点为锚，后一点的相对方位/距离决定语义，顺序与空间共同约束。' }
];

/** 对比组内两两配对 */
const PAIR_GROUPS = [
  ['开关', '单击', '按下'],
  ['滑动切换', '轻扫切换', '越界切换'],
  ['快击', '点击缓冲'],
  ['拖拽', '甩动', '翻动'],
  ['持续触发', '长按', '缓冲连发'],
  ['多点有序点击', '异位连触']
];

const ENTRY_MAP = WORD_ENTRIES.reduce((acc, item) => {
  acc[item.word] = item;
  return acc;
}, {});

function buildPairsFromGroups() {
  const pairs = [];
  let id = 1;
  PAIR_GROUPS.forEach((group) => {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = ENTRY_MAP[group[i]];
        const b = ENTRY_MAP[group[j]];
        if (!a || !b) continue;
        pairs.push({
          id: `ixdl-${id}`,
          wordA: a.word,
          blurbA: a.blurb,
          wordB: b.word,
          blurbB: b.blurb
        });
        id += 1;
      }
    }
  });
  return pairs;
}

const SPY_WORD_PAIRS = buildPairsFromGroups();

function pickRandomWordPair() {
  if (!SPY_WORD_PAIRS.length) return null;
  const pair = SPY_WORD_PAIRS[Math.floor(Math.random() * SPY_WORD_PAIRS.length)];
  const swap = Math.random() < 0.5;
  return {
    id: pair.id,
    civilianWord: swap ? pair.wordB : pair.wordA,
    civilianBlurb: swap ? pair.blurbB : pair.blurbA,
    spyWord: swap ? pair.wordA : pair.wordB,
    spyBlurb: swap ? pair.blurbA : pair.blurbB
  };
}

module.exports = {
  SPY_WORD_PAIRS,
  pickRandomWordPair,
  WORD_ENTRIES
};
