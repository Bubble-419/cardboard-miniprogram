const EMPTY_AI_SUMMARY = { status: 'pending' };

function emptyPartnerRoundContent() {
  return {
    playHistory: [],
    discussionNotes: [],
    images: [],
    voiceLines: [],
    turnRecords: [],
    aiSummary: { ...EMPTY_AI_SUMMARY }
  };
}

function normalizePartnerRoundContent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    playHistory: Array.isArray(src.playHistory) ? src.playHistory.slice() : [],
    discussionNotes: Array.isArray(src.discussionNotes) ? src.discussionNotes.slice() : [],
    images: Array.isArray(src.images) ? src.images.slice() : [],
    voiceLines: Array.isArray(src.voiceLines) ? src.voiceLines.slice() : [],
    turnRecords: Array.isArray(src.turnRecords) ? src.turnRecords.slice() : [],
    aiSummary: src.aiSummary && typeof src.aiSummary === 'object'
      ? { ...src.aiSummary }
      : { ...EMPTY_AI_SUMMARY }
  };
}

const STATEMENT_LABELS = {
  allPass: '全部通过',
  partialPass: '部分通过',
  allQuestion: '全部疑问'
};

function getStatementLabel(result) {
  return STATEMENT_LABELS[result] || result || '';
}

module.exports = {
  emptyPartnerRoundContent,
  normalizePartnerRoundContent,
  getStatementLabel,
  STATEMENT_LABELS
};
