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

module.exports = {
  CASE_SCENARIOS,
  getHistoryScenarios,
  saveHistoryScenario,
  getAllScenarios,
  buildScenarioSummary: _buildSummary
};
