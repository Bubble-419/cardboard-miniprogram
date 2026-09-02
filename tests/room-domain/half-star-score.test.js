'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeHalfStarScore } = require('@cardboard/room-domain');
const {
  clampSelectableScore,
  scoreFromTrackX,
  formatScoreDisplay,
  buildStarFills,
  resolveCardTotalStars,
  buildEarnedStarSlots,
  capEarnedStars,
  earnedStarStaggerDelays
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

  it('does not truncate half stars the way parseInt would', () => {
    assert.equal(parseInt('4.5', 10), 4);
    assert.equal(parseInt(4.5, 10), 4);
    assert.equal(normalizeHalfStarScore('4.5'), 4.5);
    assert.equal(normalizeHalfStarScore(4.5), 4.5);
    assert.equal(clampSelectableScore('3.5'), 3.5);
  });

  it('builds half-star fills', () => {
    assert.deepEqual(buildStarFills(3.5).map((s) => s.fill), [100, 100, 100, 50, 0]);
    assert.deepEqual(buildStarFills(4.5).map((s) => s.fill), [100, 100, 100, 100, 50]);
  });
});

describe('review earned-star helpers', () => {
  it('uses avgScore * scoredCount as total stars and keeps 0.5', () => {
    assert.equal(resolveCardTotalStars({ avgScore: 4, scoredCount: 2 }), 8);
    assert.equal(resolveCardTotalStars({ avgScore: 3.5, scoredCount: 3 }), 10.5);
    assert.equal(resolveCardTotalStars({ avgScore: 4.5, scoredCount: 1 }), 4.5);
  });

  it('prefers explicit totalStars over average', () => {
    assert.equal(resolveCardTotalStars({
      totalStars: 12.5,
      avgScore: 5,
      scoredCount: 1
    }), 12.5);
  });

  it('reads lookup totals without exposing a max slot count', () => {
    assert.equal(resolveCardTotalStars(
      { round: 2, playerIndex: 3 },
      { r2_p3: { totalStars: 9.5, scoredCount: 3, avgScore: 3.2 } }
    ), 9.5);
  });

  it('builds only earned full and trailing half stars', () => {
    assert.deepEqual(buildEarnedStarSlots(0), []);
    assert.deepEqual(buildEarnedStarSlots(0.5).map((s) => s.fill), [50]);
    assert.deepEqual(buildEarnedStarSlots(3).map((s) => s.fill), [100, 100, 100]);
    assert.deepEqual(buildEarnedStarSlots(3.5).map((s) => s.fill), [100, 100, 100, 50]);
    assert.equal(buildEarnedStarSlots(3.5).every((s) => s.fill !== 0), true);
  });

  it('adds a light group gap after every 5 earned stars except the last', () => {
    const ten = buildEarnedStarSlots(10);
    assert.equal(ten.length, 10);
    assert.equal(ten[4].groupGap, true);
    assert.equal(ten[9].groupGap, false);
    const five = buildEarnedStarSlots(5);
    assert.equal(five[4].groupGap, false);
  });

  it('does not invent placeholder stars up to 25', () => {
    assert.equal(buildEarnedStarSlots(7).length, 7);
    assert.equal(buildEarnedStarSlots(25).length, 25);
    assert.equal(capEarnedStars(30), 25);
  });

  it('keeps stagger within 20-25ms and under 700ms', () => {
    const three = earnedStarStaggerDelays(3);
    assert.deepEqual(three, [0, 22, 44]);
    const many = earnedStarStaggerDelays(25);
    assert.equal(many[1] - many[0], 22);
    assert.ok(many[many.length - 1] <= 680);
  });
});
