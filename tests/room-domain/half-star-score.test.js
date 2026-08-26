'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHalfStarScore } = require('@cardboard/room-domain');
const {
  clampSelectableScore,
  scoreFromTrackX,
  formatScoreDisplay,
  buildStarFills
} = require('../../utils/halfStarScore');

describe('half-star score helpers', () => {
  it('snaps to 0.5 steps and keeps 3.5', () => {
    assert.equal(normalizeHalfStarScore(3.5), 3.5);
    assert.equal(normalizeHalfStarScore('4.5'), 4.5);
    assert.equal(normalizeHalfStarScore(3.2), 3);
    assert.equal(normalizeHalfStarScore(3.3), 3.5);
    assert.equal(normalizeHalfStarScore(0), 0);
    assert.equal(normalizeHalfStarScore(null), null);
    assert.equal(normalizeHalfStarScore(6), null);
  });

  it('selectable UI scores start at 0.5', () => {
    assert.equal(clampSelectableScore(0), 0.5);
    assert.equal(clampSelectableScore(0.5), 0.5);
    assert.equal(clampSelectableScore(5), 5);
    assert.equal(clampSelectableScore(null), null);
  });

  it('maps track x to half-star scores', () => {
    assert.equal(scoreFromTrackX(0, 0, 100), 0.5);
    assert.equal(scoreFromTrackX(9, 0, 100), 0.5);
    assert.equal(scoreFromTrackX(10, 0, 100), 1);
    assert.equal(scoreFromTrackX(30, 0, 100), 2);
    assert.equal(scoreFromTrackX(80, 0, 100), 4.5);
    assert.equal(scoreFromTrackX(89, 0, 100), 4.5);
    assert.equal(scoreFromTrackX(90, 0, 100), 5);
    assert.equal(scoreFromTrackX(100, 0, 100), 5);
  });

  it('formats 4.5 without dropping to 4', () => {
    assert.equal(formatScoreDisplay(3.5), '3.5');
    assert.equal(formatScoreDisplay(4.5), '4.5');
    assert.equal(formatScoreDisplay(4), '4');
    assert.equal(formatScoreDisplay(4, { digits: 1 }), '4.0');
    assert.equal(normalizeHalfStarScore(4, 9), 4.5);
  });

  it('builds half-star fills', () => {
    assert.deepEqual(buildStarFills(3.5).map((s) => s.fill), [100, 100, 100, 50, 0]);
    assert.deepEqual(buildStarFills(4.5).map((s) => s.fill), [100, 100, 100, 100, 50]);
  });
});
