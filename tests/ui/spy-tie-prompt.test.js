const test = require('node:test');
const assert = require('node:assert/strict');

const { getTiePromptKey } = require('../../packageSpy/utils/spyTiePrompt');

test('Spy 平票提示在同一加时轮切换发言者时保持同一个确认键', () => {
  const base = {
    tieBreak: true,
    speakRoundStartedAt: 1000,
    speakTurnStartedAt: 1001,
    lastResult: {
      tied: true,
      tiedIndexes: [1, 2, 3]
    }
  };

  const firstSpeakerKey = getTiePromptKey(base);
  const nextSpeakerKey = getTiePromptKey({
    ...base,
    speakTurnStartedAt: 1002
  });

  assert.equal(nextSpeakerKey, firstSpeakerKey);
});

test('Spy 不同加时轮使用不同确认键', () => {
  const first = getTiePromptKey({
    tieBreak: true,
    speakRoundStartedAt: 1000,
    speakTurnStartedAt: 1001,
    lastResult: { tied: true, tiedIndexes: [1, 2] }
  });
  const second = getTiePromptKey({
    tieBreak: true,
    speakRoundStartedAt: 2000,
    speakTurnStartedAt: 2001,
    lastResult: { tied: true, tiedIndexes: [1, 2] }
  });

  assert.notEqual(second, first);
});
