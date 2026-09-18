'use strict';

function resolvePartnerScoreProgress(roomState) {
  const state = roomState || {};
  const progress = state.progress || {};
  const turnId = String(progress.turnId || progress.domainTurnId || '');
  const scoredCount = state.scoredCount != null
    ? Number(state.scoredCount) || 0
    : (progress.scoredCount != null ? Number(progress.scoredCount) || 0 : 0);
  const requiredScoreCount = Math.max(
    progress.requiredScoreCount != null ? Number(progress.requiredScoreCount) || 0 : 0,
    state.totalRequired != null ? Number(state.totalRequired) || 0 : 0
  );
  const accepted = !!(
    turnId
    || state.scoredCount != null
    || state.totalRequired != null
    || progress.scoredCount != null
  );
  return { accepted, turnId, scoredCount, requiredScoreCount };
}

function shouldApplyRoomSnapshot(appliedRevision, incomingRevision) {
  const applied = Number(appliedRevision) || 0;
  const incoming = Number(incomingRevision) || 0;
  if (!incoming) return true;
  if (!applied) return true;
  return incoming >= applied;
}

module.exports = { resolvePartnerScoreProgress, shouldApplyRoomSnapshot };
