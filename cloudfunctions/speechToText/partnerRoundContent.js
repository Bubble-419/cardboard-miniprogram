function emptyPartnerRoundContent() {
  return {
    playHistory: [],
    discussionNotes: [],
    playImages: [],
    discussionImages: [],
    images: [],
    voiceLines: [],
    turnRecords: [],
    aiSummary: { status: 'pending' }
  };
}

function normalizePartnerRoundContent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const legacyImages = Array.isArray(src.images) ? src.images.slice() : [];
  const playImages = Array.isArray(src.playImages) ? src.playImages.slice() : [];
  const discussionImages = Array.isArray(src.discussionImages)
    ? src.discussionImages.slice()
    : [];
  return {
    playHistory: Array.isArray(src.playHistory) ? src.playHistory.slice() : [],
    discussionNotes: Array.isArray(src.discussionNotes) ? src.discussionNotes.slice() : [],
    playImages: playImages.length ? playImages : legacyImages,
    discussionImages,
    images: legacyImages,
    voiceLines: Array.isArray(src.voiceLines) ? src.voiceLines.slice() : [],
    turnRecords: Array.isArray(src.turnRecords) ? src.turnRecords.slice() : [],
    aiSummary: src.aiSummary && typeof src.aiSummary === 'object'
      ? { ...src.aiSummary }
      : { status: 'pending' }
  };
}

const STATEMENT_LABELS = {
  allPass: '全部通过',
  partialPass: '部分通过',
  allQuestion: '有疑问进入讨论'
};

function getStatementLabel(result) {
  return STATEMENT_LABELS[result] || result || '';
}

module.exports = {
  emptyPartnerRoundContent,
  normalizePartnerRoundContent,
  getStatementLabel
};
