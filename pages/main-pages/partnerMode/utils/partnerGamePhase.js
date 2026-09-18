const PHASE_PLAY = 'play';
const PHASE_DISCUSSION = 'discussion';
const PHASE_CLOSING = 'closing';

const CLOSING_STEP_RUNE = 'rune';
const CLOSING_STEP_REVIEW = 'review';

const STATEMENT_ALL_PASS = 'allPass';
const STATEMENT_PARTIAL_PASS = 'partialPass';
const STATEMENT_ALL_QUESTION = 'allQuestion';

const CLOSING_VOTE_PASS = 'pass';
const CLOSING_VOTE_QUESTION = 'question';

function normalizePartnerGamePhase(phase) {
  if (phase === PHASE_DISCUSSION) return PHASE_DISCUSSION;
  if (phase === PHASE_CLOSING) return PHASE_CLOSING;
  return PHASE_PLAY;
}

function isDiscussionPhase(phase) {
  return normalizePartnerGamePhase(phase) === PHASE_DISCUSSION;
}

function isClosingPhase(phase) {
  return normalizePartnerGamePhase(phase) === PHASE_CLOSING;
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
  PHASE_CLOSING,
  CLOSING_STEP_RUNE,
  CLOSING_STEP_REVIEW,
  STATEMENT_ALL_PASS,
  STATEMENT_PARTIAL_PASS,
  STATEMENT_ALL_QUESTION,
  CLOSING_VOTE_PASS,
  CLOSING_VOTE_QUESTION,
  normalizePartnerGamePhase,
  isDiscussionPhase,
  isClosingPhase,
  phaseFromStatementResult
};
