/** 创意合伙人（内部 modeId: partner / partnerMode） */
const PARTNER_MODE_DISPLAY_TITLE = '创意合伙人';

const LEGACY_PARTNER_MODE_TITLES = ['合伙人模式', '脑暴大富翁'];

/** 房间页 / 模式页共用的展示名（按 selectedModeId） */
const MODE_DISPLAY_TITLES = Object.freeze({
  partner: PARTNER_MODE_DISPLAY_TITLE,
  ganDengYan: '干瞪眼模式',
  halliGalli: '德国心脏病模式',
  spy: '谁是卧底模式'
});

function titleForModeId(modeId) {
  if (!modeId) return '';
  return MODE_DISPLAY_TITLES[modeId] || '';
}

function normalizeModeDisplayTitle(title, modeId) {
  if (modeId === 'partner' || LEGACY_PARTNER_MODE_TITLES.includes(title)) {
    return PARTNER_MODE_DISPLAY_TITLE;
  }
  const normalized = title || '';
  if (normalized) return normalized;
  return titleForModeId(modeId);
}

module.exports = {
  PARTNER_MODE_DISPLAY_TITLE,
  MODE_DISPLAY_TITLES,
  titleForModeId,
  normalizeModeDisplayTitle
};
