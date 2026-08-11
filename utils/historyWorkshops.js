/**
 * 首页「历史工作坊」本地持久化
 *
 * - 创建/加入房间时 upsert 一条记录（置顶）
 * - 游戏进行中定期/离页时写入 reviewSnapshot（设计问题、成员头像、轮次纪要）
 * - 房间结束/退出时再 upsert 一次刷新时间
 * - 首页点卡片 → gamepage?mode=review，优先云端，失败则用本地快照
 */
const HISTORY_STORAGE_KEY = 'historyWorkshops';
const MAX_HISTORY_ITEMS = 20;
/** 单条快照上限，避免撑爆本地存储 */
const MAX_SNAPSHOT_CHARS = 180000;

function formatTime(ts) {
  const d = new Date(ts || Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getHistoryWorkshops() {
  try {
    const list = wx.getStorageSync(HISTORY_STORAGE_KEY);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function _slimMember(m) {
  if (!m || typeof m !== 'object') return null;
  return {
    openid: m.openid || '',
    nickName: m.nickName || m.nickname || m.name || '',
    avatarUrl: m.avatarUrl || m.avatar || '',
    avatarImage: m.avatarImage || '',
    playerIndex: m.playerIndex,
    isHost: !!m.isHost,
    isMe: !!m.isMe,
    role: m.role || ''
  };
}

function _slimSummary(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    round: item.round,
    playerIndex: item.playerIndex,
    playerName: item.playerName || '',
    playHistory: Array.isArray(item.playHistory) ? item.playHistory : [],
    discussionNotes: Array.isArray(item.discussionNotes) ? item.discussionNotes : [],
    playImages: Array.isArray(item.playImages) ? item.playImages : [],
    discussionImages: Array.isArray(item.discussionImages) ? item.discussionImages : [],
    playBlocks: Array.isArray(item.playBlocks) ? item.playBlocks : [],
    discussionBlocks: Array.isArray(item.discussionBlocks) ? item.discussionBlocks : [],
    voiceLines: Array.isArray(item.voiceLines) ? item.voiceLines : [],
    turnRecords: Array.isArray(item.turnRecords) ? item.turnRecords : [],
    statementSummary: item.statementSummary || '',
    avgScore: item.avgScore,
    allPassed: item.allPassed
  };
}

/**
 * 从 gamepage 当前态构建可回看快照（尽量精简）
 */
function buildReviewSnapshot(payload) {
  const p = payload || {};
  const members = (Array.isArray(p.members) ? p.members : [])
    .map(_slimMember)
    .filter(Boolean);
  const roundSummaries = (Array.isArray(p.roundSummaries) ? p.roundSummaries : [])
    .map(_slimSummary)
    .filter(Boolean);
  const expressMessages = Array.isArray(p.expressMessages)
    ? p.expressMessages.slice(-80).map((msg) => ({
      id: msg && msg.id,
      text: msg && msg.text,
      round: msg && msg.round,
      phase: msg && msg.phase,
      playerIndex: msg && msg.playerIndex,
      openid: msg && msg.openid,
      at: msg && msg.at
    }))
    : [];
  const problem = p.selectedDesignProblem || {};
  return {
    selectedProblemText: p.selectedProblemText || problem.text || '',
    selectedDesignProblem: problem.text
      ? { id: problem.id || '', text: problem.text }
      : null,
    members,
    roomState: {
      partnerRoundSummaries: roundSummaries,
      partnerExpressMessages: expressMessages,
      currentRound: p.currentRound != null ? p.currentRound : 1,
      brainstormSessionSeq: p.brainstormSessionSeq != null ? p.brainstormSessionSeq : 0,
      currentPlayerIndex: p.currentPlayerIndex != null ? p.currentPlayerIndex : 0,
      partnerGamePhase: 'play',
      partnerMasterMode: !!p.isMasterMode
    },
    workshopName: p.workshopName || '',
    savedAt: Date.now()
  };
}

/** 新增/更新一条历史记录并置顶；同一 roomId 只保留最新一条 */
function upsertHistoryWorkshop(entry) {
  if (!entry || !entry.roomId) return;
  try {
    const prevList = getHistoryWorkshops();
    const prev = prevList.find((it) => it && it.roomId === entry.roomId) || {};
    const list = prevList.filter((it) => it && it.roomId !== entry.roomId);

    let reviewSnapshot = entry.reviewSnapshot != null
      ? entry.reviewSnapshot
      : prev.reviewSnapshot;
    if (reviewSnapshot) {
      try {
        const size = JSON.stringify(reviewSnapshot).length;
        if (size > MAX_SNAPSHOT_CHARS) {
          // 超限时丢掉表达消息，优先保住轮次纪要
          reviewSnapshot = {
            ...reviewSnapshot,
            roomState: {
              ...(reviewSnapshot.roomState || {}),
              partnerExpressMessages: []
            }
          };
        }
      } catch (e) {
        // ignore size check
      }
    }

    list.unshift({
      id: entry.roomId,
      roomId: entry.roomId,
      name: entry.name || prev.name || '脑暴工作坊',
      creator: entry.creator || prev.creator || '',
      time: entry.time || formatTime(entry.ts || Date.now()),
      summary: entry.summary != null ? entry.summary : (prev.summary || ''),
      hasCover: false,
      cover: '',
      reviewSnapshot: reviewSnapshot || null,
      updatedAt: Date.now()
    });
    wx.setStorageSync(HISTORY_STORAGE_KEY, list.slice(0, MAX_HISTORY_ITEMS));
  } catch (e) {
    console.warn('[historyWorkshops] upsert failed', e);
  }
}

function getHistoryWorkshopByRoomId(roomId) {
  if (!roomId) return null;
  return getHistoryWorkshops().find((it) => it && it.roomId === roomId) || null;
}

function getReviewSnapshot(roomId) {
  const item = getHistoryWorkshopByRoomId(roomId);
  return (item && item.reviewSnapshot) || null;
}

/** 只更新快照（保留卡片展示字段） */
function saveReviewSnapshot(roomId, snapshot, meta) {
  if (!roomId || !snapshot) return;
  const m = meta || {};
  upsertHistoryWorkshop({
    roomId,
    name: m.name,
    creator: m.creator,
    time: m.time,
    reviewSnapshot: snapshot
  });
}

module.exports = {
  HISTORY_STORAGE_KEY,
  formatTime,
  getHistoryWorkshops,
  upsertHistoryWorkshop,
  buildReviewSnapshot,
  getHistoryWorkshopByRoomId,
  getReviewSnapshot,
  saveReviewSnapshot
};
