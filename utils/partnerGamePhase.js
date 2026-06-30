const PHASE_PLAY = 'play';
const PHASE_DISCUSSION = 'discussion';

const STATEMENT_ALL_PASS = 'allPass';
const STATEMENT_PARTIAL_PASS = 'partialPass';
const STATEMENT_ALL_QUESTION = 'allQuestion';

function normalizePartnerGamePhase(phase) {
  return phase === PHASE_DISCUSSION ? PHASE_DISCUSSION : PHASE_PLAY;
}

function isDiscussionPhase(phase) {
  return normalizePartnerGamePhase(phase) === PHASE_DISCUSSION;
}

function phaseFromStatementResult(result) {
  if (result === STATEMENT_PARTIAL_PASS || result === STATEMENT_ALL_QUESTION) {
    return PHASE_DISCUSSION;
  }
  return PHASE_PLAY;
}

module.exports = {
  PHASE_PLAY,
  PHASE_DISCUSSION,
  STATEMENT_ALL_PASS,
  STATEMENT_PARTIAL_PASS,
  STATEMENT_ALL_QUESTION,
  normalizePartnerGamePhase,
  isDiscussionPhase,
  phaseFromStatementResult
};
