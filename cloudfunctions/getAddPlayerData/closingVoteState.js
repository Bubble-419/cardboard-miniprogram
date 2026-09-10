function getBrainstormSessionSeq(room) {
  return room && room.brainstormSessionSeq != null ? room.brainstormSessionSeq : 0;
}

function toPlayerIndex(value) {
  const idx = value != null ? Number(value) : NaN;
  return Number.isFinite(idx) && idx > 0 ? idx : null;
}

function isClosingVoteInitiator(playerIndex, initiatorPlayerIndex) {
  const player = toPlayerIndex(playerIndex);
  const initiator = toPlayerIndex(initiatorPlayerIndex);
  return player != null && initiator != null && player === initiator;
}

function applyInitiatorDefaultPass(votes, initiatorPlayerIndex) {
  const next = votes && typeof votes === 'object' ? { ...votes } : {};
  const idx = toPlayerIndex(initiatorPlayerIndex);
  if (idx != null) {
    const key = String(idx);
    if (!next[key]) next[key] = 'pass';
  }
  return next;
}

function buildEmptyClosingVoteState(brainstormSessionSeq) {
  return {
    sessionId: 0,
    seq: 0,
    brainstormSessionSeq: brainstormSessionSeq != null ? brainstormSessionSeq : 0,
    initiatorPlayerIndex: null,
    votes: {}
  };
}

function normalizeClosingVoteState(raw, brainstormSessionSeq) {
  const src = raw && typeof raw === 'object' ? raw : null;
  if (!src) return null;
  const sessionSeq = src.brainstormSessionSeq != null ? src.brainstormSessionSeq : 0;
  const seq = src.seq != null ? src.seq : 0;
  const sessionId = src.sessionId != null ? src.sessionId : 0;
  if (sessionSeq !== brainstormSessionSeq || seq < 1 || sessionId < 1) return null;
  const initiatorPlayerIndex = toPlayerIndex(src.initiatorPlayerIndex);
  return {
    sessionId,
    seq,
    brainstormSessionSeq: sessionSeq,
    initiatorPlayerIndex,
    votes: applyInitiatorDefaultPass(
      src.votes && typeof src.votes === 'object' ? src.votes : {},
      initiatorPlayerIndex
    )
  };
}

function buildNewClosingVoteState(room, brainstormSessionSeq, initiatorPlayerIndex) {
  const sessionSeq = brainstormSessionSeq != null
    ? brainstormSessionSeq
    : getBrainstormSessionSeq(room);
  const prev = normalizeClosingVoteState(room && room.closingVoteState, sessionSeq);
  const prevSeq = prev ? prev.seq : 0;
  const initiator = toPlayerIndex(initiatorPlayerIndex);
  return {
    sessionId: Date.now(),
    seq: prevSeq + 1,
    brainstormSessionSeq: sessionSeq,
    initiatorPlayerIndex: initiator,
    votes: applyInitiatorDefaultPass({}, initiator)
  };
}

function resolveActiveClosingVotes(room) {
  const sessionSeq = getBrainstormSessionSeq(room);
  const state = normalizeClosingVoteState(room && room.closingVoteState, sessionSeq);
  if (state) {
    const topVotes = room && room.closingVotes && typeof room.closingVotes === 'object'
      ? room.closingVotes
      : {};
    const stateVotes = state.votes || {};
    // 有效会话以 state.votes 为准；顶层有票时合并。发起者始终默认通过。
    let votes = { ...stateVotes };
    if (Object.keys(topVotes).length > 0) {
      votes = { ...votes, ...topVotes };
    }
    votes = applyInitiatorDefaultPass(votes, state.initiatorPlayerIndex);
    return {
      votes,
      seq: state.seq,
      sessionId: state.sessionId,
      brainstormSessionSeq: sessionSeq,
      initiatorPlayerIndex: state.initiatorPlayerIndex,
      state: { ...state, votes }
    };
  }
  return {
    votes: {},
    seq: 0,
    sessionId: 0,
    brainstormSessionSeq: sessionSeq,
    initiatorPlayerIndex: null,
    state: null
  };
}

module.exports = {
  getBrainstormSessionSeq,
  toPlayerIndex,
  isClosingVoteInitiator,
  applyInitiatorDefaultPass,
  buildEmptyClosingVoteState,
  normalizeClosingVoteState,
  buildNewClosingVoteState,
  resolveActiveClosingVotes
};
