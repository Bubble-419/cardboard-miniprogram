const EMPTY_AI_SUMMARY = { status: 'pending' };

function makeBlockKey(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function blocksFromLegacy(texts, images) {
  const blocks = [];
  (Array.isArray(texts) ? texts : []).forEach((t) => {
    splitRecordSegments(typeof t === 'string' ? t : '').forEach((segment) => {
      blocks.push({ type: 'text', text: segment, key: makeBlockKey('t') });
    });
  });
  (Array.isArray(images) ? images : []).forEach((url) => {
    if (typeof url === 'string' && url) {
      blocks.push({ type: 'image', url, key: makeBlockKey('i') });
    }
  });
  return blocks;
}

/** 按换行拆成多条记录；空行忽略，首尾空白去掉 */
function splitRecordSegments(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeContentBlocks(rawBlocks, legacyTexts, legacyImages) {
  if (Array.isArray(rawBlocks) && rawBlocks.length) {
    const normalized = [];
    rawBlocks.forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      if (b.type === 'text') {
        const text = typeof b.text === 'string' ? b.text : (typeof b.value === 'string' ? b.value : '');
        const segments = splitRecordSegments(text);
        if (!segments.length) return;
        segments.forEach((segment, segIdx) => {
          normalized.push({
            type: 'text',
            text: segment,
            key: typeof b.key === 'string' && b.key && segments.length === 1
              ? b.key
              : `t_${i}_${segIdx}_${segment.slice(0, 12)}`
          });
        });
        return;
      }
      if (b.type === 'image') {
        const url = typeof b.url === 'string' ? b.url : (typeof b.value === 'string' ? b.value : '');
        if (!url) return;
        normalized.push({
          type: 'image',
          url,
          key: typeof b.key === 'string' && b.key ? b.key : `i_${i}`
        });
      }
    });
    if (normalized.length) return normalized;
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
    aiSummary: { ...EMPTY_AI_SUMMARY }
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
    // 兼容旧数据：未分阶段的 images 归入出牌解释
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
      : { ...EMPTY_AI_SUMMARY }
  };
}

function appendTextBlock(blocks, text) {
  const value = typeof text === 'string' ? text.trim() : '';
  if (!value) return Array.isArray(blocks) ? blocks.slice() : [];
  return (Array.isArray(blocks) ? blocks.slice() : []).concat({
    type: 'text',
    text: value,
    key: makeBlockKey('t')
  });
}

/** 将多段文字依次追加为独立 text block */
function appendTextSegments(blocks, raw) {
  let list = Array.isArray(blocks) ? blocks.slice() : [];
  splitRecordSegments(raw).forEach((segment) => {
    list = appendTextBlock(list, segment);
  });
  return list;
}

function appendImageBlocks(blocks, urls) {
  const list = Array.isArray(blocks) ? blocks.slice() : [];
  (Array.isArray(urls) ? urls : []).forEach((url) => {
    if (typeof url === 'string' && url) {
      list.push({ type: 'image', url, key: makeBlockKey('i') });
    }
  });
  return list;
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
  splitRecordSegments,
  appendTextBlock,
  appendTextSegments,
  appendImageBlocks,
  getStatementLabel,
  STATEMENT_LABELS
};
