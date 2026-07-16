function getBrainstormSessionSeq(room) {
  return room && room.brainstormSessionSeq != null ? room.brainstormSessionSeq : 0;
}

function buildEmptyClosingVoteState(brainstormSessionSeq) {
  return {
    sessionId: 0,
    seq: 0,
    brainstormSessionSeq: brainstormSessionSeq != null ? brainstormSessionSeq : 0,
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
  return {
    sessionId,
    seq,
    brainstormSessionSeq: sessionSeq,
    votes: src.votes && typeof src.votes === 'object' ? { ...src.votes } : {}
  };
}

function buildNewClosingVoteState(room, brainstormSessionSeq) {
  const sessionSeq = brainstormSessionSeq != null
    ? brainstormSessionSeq
    : getBrainstormSessionSeq(room);
  const prev = normalizeClosingVoteState(room && room.closingVoteState, sessionSeq);
  const prevSeq = prev ? prev.seq : 0;
  return {
    sessionId: Date.now(),
    seq: prevSeq + 1,
    brainstormSessionSeq: sessionSeq,
    votes: {}
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
    // 顶层已空而 state.votes 仍有值：云库浅合并残留，忽略
    const votes = (Object.keys(topVotes).length === 0 && Object.keys(stateVotes).length > 0)
      ? {}
      : stateVotes;
    return {
      votes,
      seq: state.seq,
      sessionId: state.sessionId,
      brainstormSessionSeq: sessionSeq,
      state: { ...state, votes }
    };
  }
  return {
    votes: {},
    seq: 0,
    sessionId: 0,
    brainstormSessionSeq: sessionSeq,
    state: null
  };
}

module.exports = {
  getBrainstormSessionSeq,
  buildEmptyClosingVoteState,
  normalizeClosingVoteState,
  buildNewClosingVoteState,
  resolveActiveClosingVotes
};
