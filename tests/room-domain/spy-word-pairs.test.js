'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  SPY_WORD_PAIRS,
  WORD_ENTRIES,
  CONTRAST_PICK_RATE,
  pickRandomWordPair
} = require('../../packages/room-domain/spyWordPairs');

function sequenceRandom(values) {
  let i = 0;
  return () => {
    if (i >= values.length) {
      throw new Error(`random sequence exhausted at call ${i}`);
    }
    const value = values[i];
    i += 1;
    return value;
  };
}

function contrastKeySet() {
  return new Set(
    SPY_WORD_PAIRS.map((pair) => [pair.wordA, pair.wordB].sort().join('|'))
  );
}

describe('pickRandomWordPair 80/20', () => {
  it('exports contrast pick rate 0.8', () => {
    assert.equal(CONTRAST_PICK_RATE, 0.8);
  });

  it('uses contrast pairs when mode roll is below 0.8', () => {
    const keys = contrastKeySet();
    // mode < 0.8, pair index 0, swap=false (roll >= 0.5)
    const result = pickRandomWordPair(sequenceRandom([0.1, 0, 0.6]));
    assert.ok(result);
    assert.equal(result.id, SPY_WORD_PAIRS[0].id);
    assert.equal(result.civilianWord, SPY_WORD_PAIRS[0].wordA);
    assert.equal(result.spyWord, SPY_WORD_PAIRS[0].wordB);
    assert.ok(keys.has([result.civilianWord, result.spyWord].sort().join('|')));
  });

  it('swaps civilian/spy words when swap roll is below 0.5', () => {
    // mode < 0.8, pair index 0, swap=true
    const result = pickRandomWordPair(sequenceRandom([0.1, 0, 0.2]));
    assert.equal(result.civilianWord, SPY_WORD_PAIRS[0].wordB);
    assert.equal(result.spyWord, SPY_WORD_PAIRS[0].wordA);
    assert.equal(result.id, SPY_WORD_PAIRS[0].id);
  });

  it('picks two distinct WORD_ENTRIES when mode roll is at or above 0.8', () => {
    const words = new Set(WORD_ENTRIES.map((item) => item.word));
    // mode >= 0.8, i=0, j mapped to 1, swap=false
    const result = pickRandomWordPair(sequenceRandom([0.8, 0, 0, 0.6]));
    assert.ok(result);
    assert.equal(result.id, `random-${WORD_ENTRIES[0].word}-${WORD_ENTRIES[1].word}`);
    assert.equal(result.civilianWord, WORD_ENTRIES[0].word);
    assert.equal(result.spyWord, WORD_ENTRIES[1].word);
    assert.notEqual(result.civilianWord, result.spyWord);
    assert.ok(words.has(result.civilianWord));
    assert.ok(words.has(result.spyWord));
    assert.equal(result.civilianBlurb, WORD_ENTRIES[0].blurb);
    assert.equal(result.spyBlurb, WORD_ENTRIES[1].blurb);
  });

  it('keeps free-pair id stable across role swap', () => {
    // mode >= 0.8, i=0, j->1, swap=true
    const result = pickRandomWordPair(sequenceRandom([0.85, 0, 0, 0.2]));
    assert.equal(result.id, `random-${WORD_ENTRIES[0].word}-${WORD_ENTRIES[1].word}`);
    assert.equal(result.civilianWord, WORD_ENTRIES[1].word);
    assert.equal(result.spyWord, WORD_ENTRIES[0].word);
  });
});
