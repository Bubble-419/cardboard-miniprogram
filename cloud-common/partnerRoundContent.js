function makeBlockKey(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function blocksFromLegacy(texts, images) {
  const blocks = [];
  (Array.isArray(texts) ? texts : []).forEach((t) => {
    if (typeof t === 'string' && t.trim()) {
      blocks.push({ type: 'text', text: t, key: makeBlockKey('t') });
    }
  });
  (Array.isArray(images) ? images : []).forEach((url) => {
    if (typeof url === 'string' && url) {
      blocks.push({ type: 'image', url, key: makeBlockKey('i') });
    }
  });
  return blocks;
}

function normalizeContentBlocks(rawBlocks, legacyTexts, legacyImages) {
  if (Array.isArray(rawBlocks) && rawBlocks.length) {
    return rawBlocks
      .map((b, i) => {
        if (!b || typeof b !== 'object') return null;
        if (b.type === 'text') {
          const text = typeof b.text === 'string' ? b.text : (typeof b.value === 'string' ? b.value : '');
          if (!text.trim()) return null;
          return {
            type: 'text',
            text,
            key: typeof b.key === 'string' && b.key ? b.key : `t_${i}_${text.slice(0, 12)}`
          };
        }
        if (b.type === 'image') {
          const url = typeof b.url === 'string' ? b.url : (typeof b.value === 'string' ? b.value : '');
          if (!url) return null;
          return {
            type: 'image',
            url,
            key: typeof b.key === 'string' && b.key ? b.key : `i_${i}`
          };
        }
        return null;
      })
      .filter(Boolean);
  }
  return blocksFromLegacy(legacyTexts, legacyImages);
}

function deriveListsFromBlocks(blocks) {
  const texts = [];
  const images = [];
  (Array.isArray(blocks) ? blocks : []).forEach((b) => {
    if (!b) return;
    if (b.type === 'text' && typeof b.text === 'string' && b.text) texts.push(b.text);
    if (b.type === 'image' && typeof b.url === 'string' && b.url) images.push(b.url);
  });
  return { texts, images };
}

function emptyPartnerRoundContent() {
  return {
    playHistory: [],
    discussionNotes: [],
    playImages: [],
    discussionImages: [],
    playBlocks: [],
    discussionBlocks: [],
    images: [],
    voiceLines: [],
    turnRecords: [],
    aiSummary: { status: 'pending' }
  };
}

function normalizePartnerRoundContent(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const legacyImages = Array.isArray(src.images) ? src.images.slice() : [];
  const playImagesRaw = Array.isArray(src.playImages) ? src.playImages.slice() : [];
  const discussionImagesRaw = Array.isArray(src.discussionImages)
    ? src.discussionImages.slice()
    : [];
  const playHistory = Array.isArray(src.playHistory) ? src.playHistory.slice() : [];
  const discussionNotes = Array.isArray(src.discussionNotes) ? src.discussionNotes.slice() : [];
  const playImages = playImagesRaw.length ? playImagesRaw : legacyImages;
  const discussionImages = discussionImagesRaw;
  const playBlocks = normalizeContentBlocks(src.playBlocks, playHistory, playImages);
  const discussionBlocks = normalizeContentBlocks(
    src.discussionBlocks,
    discussionNotes,
    discussionImages
  );
  const playDerived = deriveListsFromBlocks(playBlocks);
  const discussionDerived = deriveListsFromBlocks(discussionBlocks);
  return {
    playHistory: playDerived.texts.length ? playDerived.texts : playHistory,
    discussionNotes: discussionDerived.texts.length ? discussionDerived.texts : discussionNotes,
    playImages: playDerived.images.length ? playDerived.images : playImages,
    discussionImages: discussionDerived.images.length
      ? discussionDerived.images
      : discussionImages,
    playBlocks,
    discussionBlocks,
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
  allQuestion: '全部疑问'
};

function getStatementLabel(result) {
  return STATEMENT_LABELS[result] || result || '';
}

module.exports = {
  emptyPartnerRoundContent,
  normalizePartnerRoundContent,
  normalizeContentBlocks,
  deriveListsFromBlocks,
  getStatementLabel
};
