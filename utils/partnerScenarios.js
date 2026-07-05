const STORAGE_KEY = 'partnerMode_history_scenarios';

/** 预设案例情境 */
const CASE_SCENARIOS = [
  {
    id: 'case-1',
    type: 'case',
    title: '案例情境 1',
    bg: {
      scene: '智能座舱',
      user: '下班后的网约车乘客',
      platform: '车载中控屏',
      function: '调节空调与氛围灯'
    }
  },
  {
    id: 'case-2',
    type: 'case',
    title: '案例情境 2',
    bg: {
      scene: '商场中庭',
      user: '周末逛街的年轻家庭',
      platform: '商场导览大屏',
      function: '查找店铺与活动信息'
    }
  }
];

function _buildSummary(bg) {
  if (!bg) return '';
  const parts = [bg.scene, bg.user, bg.platform, bg.function].filter(Boolean);
  return parts.join(' · ');
}

function getHistoryScenarios() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY);
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    console.warn('getHistoryScenarios', e);
    return [];
  }
}

function saveHistoryScenario(bg) {
  if (!bg || !bg.scene || !bg.user || !bg.function) return;
  const history = getHistoryScenarios();
  const summary = _buildSummary(bg);
  const duplicate = history.find(
    (item) => item.summary === summary
      || (item.bg
        && item.bg.scene === bg.scene
        && item.bg.user === bg.user
        && item.bg.platform === bg.platform
        && item.bg.function === bg.function)
  );
  if (duplicate) return;

  const nextIndex = history.length + 1;
  const entry = {
    id: `history-${Date.now()}`,
    type: 'history',
    title: `历史情境 ${nextIndex}`,
    summary,
    bg: { ...bg },
    savedAt: Date.now()
  };
  history.unshift(entry);
  try {
    wx.setStorageSync(STORAGE_KEY, history.slice(0, 20));
  } catch (e) {
    console.warn('saveHistoryScenario', e);
  }
}

/** 仅用户自行新增的情境才写入历史，案例/历史/线下情境不重复保存 */
function shouldSaveSelectedBGToHistory(source) {
  return source === 'custom';
}

const OFFLINE_SCENARIO = {
  id: 'offline',
  type: 'offline',
  title: '线下情境',
  summary: '选择线下大屏上已展示的情境，直接进入游戏',
  isOffline: true
};

function getAllScenarios() {
  const history = getHistoryScenarios().map((item, index) => ({
    ...item,
    title: item.title || `历史情境 ${index + 1}`,
    summary: item.summary || _buildSummary(item.bg)
  }));
  return CASE_SCENARIOS.map((item) => ({
    ...item,
    summary: _buildSummary(item.bg)
  })).concat(history);
}

/** 按游戏模式返回情境列表；halliGalli / partner 在首位插入线下情境 */
function getScenariosForMode(modeId) {
  const list = getAllScenarios();
  if (modeId === 'halliGalli' || modeId === 'partner') {
    return [OFFLINE_SCENARIO, ...list];
  }
  return list;
}

/** 脑暴大富翁（partnerMode）流程中，恢复进度前需已选情境的页面 */
const PARTNER_PAGES_NEED_BG = [
  'confirmbg',
  'submitproblem',
  'selectproblem',
  'selectmode',
  'selectplayer',
  'confirmfirstplayer'
];

function isValidPartnerBG(bg, options = {}) {
  const { requirePlatform = false } = options;
  if (!bg || !bg.scene || !bg.user || !bg.function) return false;
  if (requirePlatform && !bg.platform) return false;
  return true;
}

function partnerPageNeedsBG(page) {
  return PARTNER_PAGES_NEED_BG.includes((page || '').toLowerCase());
}

module.exports = {
  CASE_SCENARIOS,
  OFFLINE_SCENARIO,
  getHistoryScenarios,
  saveHistoryScenario,
  shouldSaveSelectedBGToHistory,
  getAllScenarios,
  getScenariosForMode,
  buildScenarioSummary: _buildSummary,
  isValidPartnerBG,
  partnerPageNeedsBG
};
