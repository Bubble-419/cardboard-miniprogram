/** 脑暴大富翁（内部 modeId: partner / partnerMode） */
const PARTNER_MODE_DISPLAY_TITLE = '脑暴大富翁';

const LEGACY_PARTNER_MODE_TITLES = ['合伙人模式'];

function normalizeModeDisplayTitle(title, modeId) {
  if (modeId === 'partner' || LEGACY_PARTNER_MODE_TITLES.includes(title)) {
    return PARTNER_MODE_DISPLAY_TITLE;
  }
  return title || '';
}

module.exports = {
  PARTNER_MODE_DISPLAY_TITLE,
  normalizeModeDisplayTitle
};
