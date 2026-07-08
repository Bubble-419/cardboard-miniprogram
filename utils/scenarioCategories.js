const CONTEXT_ICONS = {
  scene: '/assets/icons/icon-context-scene.png',
  user: '/assets/icons/icon-context-user.png',
  platform: '/assets/icons/icon-context-platform.png',
  function: '/assets/icons/icon-context-function.png'
};

const DEFAULT_CATEGORIES = [
  { id: 1, key: 'scene', label: '场景', name: '场景', icon: CONTEXT_ICONS.scene, selected: false },
  { id: 2, key: 'user', label: '用户', name: '用户', icon: CONTEXT_ICONS.user, selected: false },
  { id: 3, key: 'platform', label: '平台', name: '平台', icon: CONTEXT_ICONS.platform, selected: false },
  { id: 4, key: 'function', label: '功能', name: '功能', icon: CONTEXT_ICONS.function, selected: false }
];

/** 根据已选情境生成情境展示项（仅含有效值） */
function buildContextDisplayItems(bg) {
  const normalized = normalizeBG(bg);
  if (!normalized) return [];
  return DEFAULT_CATEGORIES
    .filter((item) => normalized[item.key])
    .map((item) => ({
      ...item,
      label: item.label,
      name: normalized[item.key]
    }));
}

/** 根据已选情境生成分类标签列表 */
function buildCategoriesFromBG(bg) {
  if (!bg) {
    return DEFAULT_CATEGORIES.map((item) => ({ ...item }));
  }
  return DEFAULT_CATEGORIES.map((item) => {
    let name = item.label;
    if (item.key === 'scene' && bg.scene) name = bg.scene;
    if (item.key === 'user' && bg.user) name = bg.user;
    if (item.key === 'platform' && bg.platform) name = bg.platform;
    if (item.key === 'function' && bg.function) name = bg.function;
    return { ...item, name };
  }).filter((item) => !(item.key === 'platform' && !bg.platform));
}

/** 写入 globalData，供后续页面使用 */
function applyBGToApp(bg) {
  if (!bg || (!bg.scene && !bg.user && !bg.function)) return;
  const app = getApp();
  app.globalData = app.globalData || {};
  app.globalData.selectedBG = {
    scene: bg.scene || '',
    user: bg.user || '',
    function: bg.function || ''
  };
  if (bg.platform) {
    app.globalData.selectedBG.platform = bg.platform;
  }
}

/** 规范化云端/本地情境对象 */
function normalizeBG(bg) {
  if (!bg || typeof bg !== 'object') return null;
  if (!bg.scene && !bg.user && !bg.function) return null;
  const out = {
    scene: bg.scene || '',
    user: bg.user || '',
    function: bg.function || ''
  };
  if (bg.platform) out.platform = bg.platform;
  return out;
}

module.exports = {
  CONTEXT_ICONS,
  DEFAULT_CATEGORIES,
  buildContextDisplayItems,
  buildCategoriesFromBG,
  applyBGToApp,
  normalizeBG
};
