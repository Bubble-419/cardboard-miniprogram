/**
 * AI 功能总开关。
 * 暂未接入 AI 时保持 false；恢复时改为 true，并核对各页 AI_TEMP_DISABLED 注释块。
 */
const AI_FEATURE_ENABLED = false;

function isAiFeatureEnabled() {
  return AI_FEATURE_ENABLED === true;
}

module.exports = {
  AI_FEATURE_ENABLED,
  isAiFeatureEnabled
};
