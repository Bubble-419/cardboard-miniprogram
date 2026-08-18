/**
 * 谁是卧底：平票后回发言前的确认弹层，以及并列名单文案。
 * 弹层按「本轮平票」只出一次，投票页 / 发言页共用 ack，避免重复打断。
 */

let ackedKey = '';
let modalShowing = false;

function getTiePromptKey(spyGame) {
  if (!spyGame || spyGame.tieBreak !== true) return '';
  const last = spyGame.lastResult || {};
  if (!last.tied) return '';
  const ids = Array.isArray(last.tiedIndexes)
    ? last.tiedIndexes.map((idx) => Number(idx)).filter((n) => Number.isFinite(n)).join(',')
    : '';
  return `${ids}:${spyGame.speakTurnStartedAt || spyGame.speakRoundStartedAt || 0}`;
}

function buildTiedNames(spyGame) {
  const last = (spyGame && spyGame.lastResult) || {};
  const indexes = Array.isArray(last.tiedIndexes) ? last.tiedIndexes : [];
  const players = (spyGame && spyGame.players) || [];
  return indexes.map((idx) => {
    const p = players.find((x) => Number(x.playerIndex) === Number(idx));
    return (p && p.name) || `玩家${idx}`;
  }).filter(Boolean);
}

function isTieReturnPending(spyGame) {
  const phase = spyGame && spyGame.phase;
  if (phase !== 'speak') return false;
  const key = getTiePromptKey(spyGame);
  if (!key) return false;
  return ackedKey !== key;
}

function markTiePromptAcked(spyGame) {
  const key = getTiePromptKey(spyGame);
  if (key) ackedKey = key;
}

function isTieModalShowing() {
  return modalShowing;
}

/**
 * 平票后必须点「确定」才能进发言页。
 * @returns {boolean} 正在展示弹层（调用方应停住跟随）
 */
function showTieReturnModal(spyGame, onConfirm) {
  if (!isTieReturnPending(spyGame)) return false;
  if (modalShowing) return true;

  modalShowing = true;
  const names = buildTiedNames(spyGame);
  const nameText = names.length ? names.join('、') : '多名玩家';
  wx.showModal({
    title: '本轮平票',
    content: `最高票并列：${nameText}。点击确定后进入加时陈述。`,
    showCancel: false,
    confirmText: '确定',
    complete() {
      modalShowing = false;
      markTiePromptAcked(spyGame);
      if (typeof onConfirm === 'function') onConfirm();
    }
  });
  return true;
}

module.exports = {
  getTiePromptKey,
  buildTiedNames,
  isTieReturnPending,
  markTiePromptAcked,
  isTieModalShowing,
  showTieReturnModal
};
