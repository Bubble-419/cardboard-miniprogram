'use strict';

function modeId(mode) {
  return { PARTNER: 'partner', HALLI_GALLI: 'halliGalli', SPY: 'spy' }[mode] || null;
}

function routePageKey(routeName) {
  return {
    addPlayer: 'addPlayer', modeIndex: 'auth', subAwait: 'subAwait', submitProblem: 'submitProblem',
    selectProblem: 'selectProblem', selectPlayer: 'selectPlayer', confirmFirstPlayer: 'confirmFirstPlayer',
    partnerGame: 'gamepage', closingStatement: 'closingStatement', leaderboard: 'leaderboard',
    halliGame: 'gamepage', creativeInput: 'creativeInput', creativeSummary: 'creativeSummary',
    spyIntro: 'spyModeIndex', spySpeak: 'spySpeak', spyVote: 'spyVote',
    spyResult: 'spyResult', spySettle: 'spySettle'
  }[routeName] || routeName || 'addPlayer';
}

function memberSeat(view, memberId) {
  const member = view && view.room && view.room.members.find((item) => item.memberId === memberId);
  if (member) return member.seatNo;
  const participant = view && view.session && (view.session.participants || [])
    .find((item) => item.memberId === memberId);
  return participant ? participant.seatNoAtStart : null;
}

function pageMembers(view) {
  if (!view || !view.room) return [];
  return view.room.members.map((member) => ({
    _id: member.memberId,
    memberId: member.memberId,
    // 页面只拿到不可反查 openid 的 memberId。
    userId: member.memberId,
    playerIndex: member.seatNo,
    role: member.memberId === view.room.hostMemberId ? 'GOD' : 'PLAYER',
    nickName: member.nickName,
    avatarUrl: member.avatarRef || null,
    avatarIndex: member.avatarIndex,
    avatarColor: member.color,
    joinedAt: member.joinedAt,
    isMe: !!(view.actor && view.actor.memberId === member.memberId)
  }));
}

function partnerContent(session, acceptedStages) {
  const stageSet = acceptedStages ? new Set(acceptedStages) : null;
  const content = { playHistory: [], discussionNotes: [], playImages: [], discussionImages: [],
    playBlocks: [], discussionBlocks: [], voiceLines: [], turnRecords: [] };
  (session.activeArtifacts || []).forEach((item) => {
    if (stageSet && !stageSet.has(item.stage)) return;
    const discussion = item.stage === 'DISCUSSION';
    const blocks = discussion ? content.discussionBlocks : content.playBlocks;
    if (item.kind === 'IMAGE' || (item.fileRef && !item.text)) {
      const url = item.fileRef || '';
      blocks.push({ type: 'image', url, key: item.artifactId, operationId: item.operationId,
        entityVersion: item.entityVersion });
      (discussion ? content.discussionImages : content.playImages).push(url);
    } else if (item.kind === 'VOICE') {
      content.voiceLines.push({ id: item.artifactId, text: item.text || '', fileRef: item.fileRef || null });
    } else if (item.text) {
      blocks.push({ type: 'text', text: item.text, key: item.artifactId,
        operationId: item.operationId, entityVersion: item.entityVersion });
      (discussion ? content.discussionNotes : content.playHistory).push(item.text);
    }
  });
  return content;
}

function partnerSummary(view, summary) {
  const member = view.room.members.find((item) => item.memberId === summary.activeMemberId)
    || (view.session.participants || []).find((item) => item.memberId === summary.activeMemberId);
  const content = partnerContent({ activeArtifacts: summary.artifacts || [] }, ['PLAY', 'DISCUSSION']);
  const turnRecord = {
    playerIndex: member && (member.seatNo || member.seatNoAtStart),
    playerName: member && member.nickName,
    statementResult: summary.statementResult,
    avgScore: summary.avgScore,
    scoredCount: summary.scoredCount,
    totalStars: summary.totalStars,
    recordedAt: summary.completedAt
  };
  return {
    ...summary,
    // 旧页面把 round 当作全局行动序号，V3 的业务 roundNo 另行保留。
    round: summary.turnOrdinal,
    playerIndex: member && (member.seatNo || member.seatNoAtStart),
    playerName: member && member.nickName,
    archivedAt: summary.completedAt,
    ...content,
    turnRecords: [turnRecord]
  };
}

function spyPageState(view, session) {
  const state = session.publicModeState || {};
  const revealByMember = {};
  (state.reveal || []).forEach((item) => { revealByMember[item.memberId] = item; });
  const phaseByStep = {
    SPY_INTRO: 'intro', SPY_SPEAK: 'speak', SPY_TIE_SPEAK: 'speak', SPY_VOTE: 'vote',
    SPY_RESULT: 'result', SPY_SETTLED: 'settle'
  };
  const players = (state.players || []).map((player) => ({
    playerIndex: player.seatNoAtStart,
    memberId: player.memberId,
    name: player.nickName,
    nickName: player.nickName,
    avatarUrl: player.avatarRef || null,
    alive: player.alive,
    left: player.left,
    ...(revealByMember[player.memberId] || {})
  }));
  const rawResult = state.lastResult || {};
  const tallies = {};
  Object.entries(rawResult.tallies || {}).forEach(([memberId, count]) => {
    const seat = memberSeat(view, memberId);
    if (seat != null) tallies[seat] = count;
  });
  const result = {
    ...rawResult,
    eliminatedIndex: memberSeat(view, rawResult.eliminatedMemberId),
    tiedIndexes: (rawResult.tiedMemberIds || []).map((memberId) => memberSeat(view, memberId)),
    tallies
  };
  const actorSeat = view.actor && view.actor.seatNo;
  const reveal = state.reveal || [];
  const civilian = reveal.find((item) => item.role === 'civilian');
  const spy = reveal.find((item) => item.role === 'spy');
  return {
    gameId: state.gameId,
    phase: phaseByStep[session.workflow.step] || 'intro',
    round: state.roundNo,
    roundNo: state.roundNo,
    players,
    speakOrder: (state.speakOrder || []).map((memberId) => memberSeat(view, memberId)),
    currentSpeakerIndex: state.currentSpeakerIndex || 0,
    speakerTurnId: state.speakerTurnId,
    speakRoundStartedAt: state.speakRoundStartedAt,
    speakTurnStartedAt: state.speakTurnStartedAt,
    voteSessionId: state.voteSessionId,
    voteStartedAt: state.voteStartedAt,
    votedCount: state.votedCount,
    requiredVoteCount: state.requiredVoteCount,
    voteStatus: {
      votedCount: state.votedCount || 0,
      totalVoters: state.requiredVoteCount || 0,
      votedPlayerIndexes: view.actor && view.actor.voteStatus.submitted ? [actorSeat] : []
    },
    voteDeadlineMs: 2 * 60 * 1000,
    tieBreak: state.tieBreak,
    tiedPlayerIndexes: (result.tiedMemberIds || []).map((memberId) => memberSeat(view, memberId)),
    eliminatedPlayerIndex: memberSeat(view, result.eliminatedMemberId),
    lastResult: result,
    winnerSide: state.winnerSide,
    reveal,
    civilianWord: civilian && civilian.word || '',
    spyWord: spy && spy.word || ''
  };
}

/**
 * 现有 WXML 的页面模型。它只由 V3 MemberView 投影，不再保存或推断第二份远端事实。
 */
function projectPageSnapshot(view, clientState) {
  if (!view) {
    const lastError = clientState && clientState.error;
    return { ok: !lastError, roomId: clientState && clientState.roomId,
      errCode: lastError && lastError.errCode, errMsg: lastError && lastError.errMsg,
      revision: clientState && clientState.seq || 0, members: [], memberCount: 0, roomState: null,
      view: null, ephemeral: clientState && clientState.ephemeral || {} };
  }
  const session = view.session;
  const members = pageMembers(view);
  const roomState = {
    protocolVersion: 3,
    revision: clientState.seq,
    lifecycle: view.room.lifecycle,
    workflow: session && session.workflow,
    sessionId: session && session.sessionId || '',
    selectedModeId: session && modeId(session.mode),
    currentPage: routePageKey(view.route && view.route.name),
    brainstormSessionEnded: !!(session && session.status === 'COMPLETED'),
    selectedBG: session && session.setup.scenario,
    selectedDesignProblem: session && session.setup.selectedProblem,
    memberCount: members.length
  };
  if (session && session.mode === 'PARTNER') {
    const turn = session.activeTurn;
    const closing = session.publicModeState.closing;
    const activeMember = turn && members.find((item) => item.memberId === turn.activeMemberId);
    const step = session.workflow.step;
    roomState.partnerGamePhase = step === 'PARTNER_STATEMENT' ? 'discussion'
      : (step.startsWith('PARTNER_CLOSING_') ? 'closing' : 'play');
    roomState.currentPlayerIndex = activeMember && activeMember.playerIndex;
    roomState.currentPlayerName = activeMember && activeMember.nickName;
    roomState.currentRound = turn ? turn.ordinal : session.publicModeState.turnOrdinal;
    roomState.partnerRoundNo = turn ? turn.roundNo : session.publicModeState.roundNo;
    roomState.partnerTurnStartedAt = turn && turn.turnStartedAt;
    roomState.partnerRoundStartedAt = turn && turn.phaseStartedAt;
    roomState.partnerMasterMode = !!(turn && turn.masterMode);
    const projectedNow = clientState && Number(clientState.serverNow);
    const serverNow = Number.isFinite(projectedNow) ? projectedNow : Date.now();
    roomState.partnerSilentMode = !!(turn && turn.silentDeadlineAt && turn.silentDeadlineAt > serverNow);
    roomState.partnerSilentStartedAt = turn && turn.silentStartedAt;
    const silentSignal = clientState && clientState.ephemeral && clientState.ephemeral.signals
      && clientState.ephemeral.signals.PARTNER_SILENT_SOUND;
    roomState.partnerSilentSoundLevel = silentSignal ? silentSignal.value : 0;
    roomState.partnerClosingStep = closing && closing.stage;
    roomState.closingVoteSessionId = closing && closing.closingVoteSessionId;
    roomState.closingVoteInitiatorIndex = closing && memberSeat(view, closing.initiatorMemberId);
    roomState.closingVoteSubmittedCount = closing && closing.votedCount;
    roomState.closingVoteRequiredCount = closing && closing.requiredCount;
    roomState.scoredCount = turn && turn.scoredCount || 0;
    roomState.totalRequired = turn && turn.requiredScoreCount || 0;
    roomState.progress = { scoredCount: roomState.scoredCount, requiredScoreCount: roomState.totalRequired,
      // 兼容现有页面的显示键；真实并发上下文始终使用 activeTurn.turnId。
      turnId: turn && `turn_r${turn.ordinal}_s${activeMember && activeMember.playerIndex}`,
      domainTurnId: turn && turn.turnId };
    roomState.myScoreHalfSteps = view.actor.scoreStatus.submitted ? view.actor.scoreStatus.scoreHalfSteps : null;
    roomState.myScore = roomState.myScoreHalfSteps == null ? null : roomState.myScoreHalfSteps / 2;
    roomState.partnerExpressMessages = (session.recentMessages || []).map((item) => ({
      id: item.messageId, text: item.text, anonKey: item.anonKey, at: item.createdAt,
      sessionId: session.sessionId,
      round: item.turnOrdinal, roundNo: item.roundNo, phase: item.phase || roomState.partnerGamePhase
    }));
    roomState.partnerCurrentRoundContent = partnerContent(session, ['PLAY', 'DISCUSSION']);
    roomState.partnerRoundSummaries = (session.turnSummaries || []).map((item) => partnerSummary(view, item));
    const closingContent = partnerContent(session, ['CLOSING_RUNE', 'CLOSING_REVIEW']);
    roomState.partnerClosingCreativePoints = { blocks: closingContent.playBlocks,
      texts: closingContent.playHistory, images: closingContent.playImages };
    roomState.partnerSpecialMoveUsed = turn && turn.specialUsed || null;
  } else if (session && session.mode === 'HALLI_GALLI') {
    roomState.currentPlayerIndex = memberSeat(view, session.publicModeState.firstMemberId);
    const first = members.find((item) => item.playerIndex === roomState.currentPlayerIndex);
    roomState.currentPlayerName = first && first.nickName || '';
  } else if (session && session.mode === 'SPY') {
    roomState.spyGame = spyPageState(view, session);
  }
  const result = {
    ok: true,
    protocolVersion: 3,
    roomId: view.room.roomId,
    revision: clientState.seq,
    isHost: view.actor.role === 'HOST',
    role: view.actor.role === 'HOST' ? 'GOD' : 'PLAYER',
    members,
    memberCount: members.length,
    workshopName: view.room.workshopName,
    createdAt: view.room.createdAt,
    joinedAt: members.find((item) => item.isMe) && members.find((item) => item.isMe).joinedAt,
    selectedModeId: session && modeId(session.mode),
    hasSelectedMode: !!session,
    brainstormSessionEnded: !!(session && session.status === 'COMPLETED'),
    selectedBG: session && session.setup.scenario,
    selectedDesignProblem: session && session.setup.selectedProblem,
    roomState,
    view,
    ephemeral: clientState.ephemeral || {}
  };
  result.raw = result;
  return result;
}

module.exports = { projectPageSnapshot, pageMembers, memberSeat };
