'use strict';

const { PROTOCOL_VERSION, MODE, WORKFLOW_STEP } = require('../../packages/room-contracts/index');
const { getStatementLabel } = require('../../utils/partnerRoundContent');

const PARTNER_CLOSING_STEPS = new Set([
  WORKFLOW_STEP.PARTNER_CLOSING_VOTE,
  WORKFLOW_STEP.PARTNER_CLOSING_RUNE,
  WORKFLOW_STEP.PARTNER_CLOSING_REVIEW
]);

function partnerClosingStep(stage) {
  if (stage === 'RUNE') return 'rune';
  if (stage === 'REVIEW') return 'review';
  return null;
}

function modeId(mode) {
  return {
    PARTNER: 'partner',
    GAN_DENG_YAN: 'ganDengYan',
    HALLI_GALLI: 'halliGalli',
    SPY: 'spy'
  }[mode] || null;
}

function isHalliLikeMode(mode) {
  return mode === MODE.HALLI_GALLI || mode === MODE.GAN_DENG_YAN;
}

function routePageKey(routeName) {
  return {
    addPlayer: 'addPlayer', brainstormMode: 'brainstormMode', modeIndex: 'auth', subAwait: 'subAwait', submitProblem: 'submitProblem',
    selectProblem: 'selectProblem', selectPlayer: 'selectPlayer', confirmFirstPlayer: 'confirmFirstPlayer',
    partnerGame: 'gamepage', closingStatement: 'closingStatement', leaderboard: 'leaderboard',
    halliGame: 'gamepage', creativeInput: 'creativeInput', creativeSummary: 'creativeSummary',
    spyIntro: 'spyModeIndex', spySpeak: 'spySpeak', spyVote: 'spyVote',
    spyResult: 'spyResult', spySettle: 'spySettle'
  }[routeName] || routeName || 'addPlayer';
}

function memberSeat(view, memberId) {
  const participant = view && view.session && (view.session.participants || [])
    .find((item) => item.memberId === memberId);
  if (participant) return participant.seatNoAtStart;
  const member = view && view.room && view.room.members.find((item) => item.memberId === memberId);
  return member ? member.seatNo : null;
}

function pageMembers(view, historical) {
  if (!view || !view.room) return [];
  const liveById = new Map((view.room.members || []).map((member) => [member.memberId, member]));
  // 当前场次页面只能展示场次开始时冻结的 Participant；中途加入者在大厅仍看 Room Member。
  const useFrozenParticipants = !!(view.session && Array.isArray(view.session.participants)
    && (historical || (view.actor && view.actor.isParticipant)));
  const includeDeparted = !!(historical || (view.session
    && ['COMPLETED', 'CANCELLED'].includes(view.session.status)));
  const participants = useFrozenParticipants
    ? view.session.participants.filter((participant) => includeDeparted || participant.status === 'ACTIVE')
    : [];
  const source = useFrozenParticipants
    ? participants.map((participant) => ({
      memberId: participant.memberId,
      seatNo: participant.seatNoAtStart,
      nickName: participant.nickName,
      avatarRef: participant.avatarRef || null,
      avatarIndex: participant.avatarIndex,
      color: participant.color,
      joinedAt: liveById.get(participant.memberId) && liveById.get(participant.memberId).joinedAt,
      participantStatus: participant.status
    }))
    : view.room.members;
  // 历史/结算页保留全部冻结资料；进行中页只展示仍在场的 Participant，不能让离房者继续参与 UI 选择。
  return source.slice().sort((a, b) => a.seatNo - b.seatNo).map((member) => ({
    _id: member.memberId,
    memberId: member.memberId,
    playerIndex: member.seatNo,
    role: member.memberId === view.room.hostMemberId ? 'GOD' : 'PLAYER',
    nickName: member.nickName,
    avatarUrl: member.avatarRef || null,
    avatarIndex: member.avatarIndex,
    avatarColor: member.color,
    joinedAt: member.joinedAt,
    participantStatus: member.participantStatus || null,
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
      blocks.push({ type: 'image', url, fileRef: item.fileRef || url, key: item.artifactId, operationId: item.operationId,
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
  const member = (view.session.participants || []).find((item) => item.memberId === summary.activeMemberId)
    || view.room.members.find((item) => item.memberId === summary.activeMemberId);
  const content = partnerContent({ activeArtifacts: summary.artifacts || [] }, ['PLAY', 'DISCUSSION']);
  const closingContent = partnerContent(
    { activeArtifacts: summary.artifacts || [] },
    ['CLOSING_RUNE', 'CLOSING_REVIEW']
  );
  const turnRecord = {
    playerIndex: member && (member.seatNo || member.seatNoAtStart),
    playerName: member && member.nickName,
    statementResult: summary.statementResult,
    statementLabel: getStatementLabel(summary.statementResult),
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
    closingReviewNotes: closingContent.playHistory,
    closingReviewImages: closingContent.playImages,
    closingReviewBlocks: closingContent.playBlocks,
    turnRecords: [turnRecord]
  };
}

function clientClockTimestamp(value, offsetMs) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return value == null ? null : value;
  return timestamp - (Number(offsetMs) || 0);
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
    // 谁是卧底计时器显式使用 RoomClient.serverNow()，这里保留服务端时钟域。
    speakRoundStartedAt: state.speakRoundStartedAt,
    speakTurnStartedAt: state.speakTurnStartedAt,
    voteSessionId: state.voteSessionId,
    voteStartedAt: state.voteStartedAt,
    voteDeadlineAt: state.voteDeadlineAt,
    votedCount: state.votedCount,
    requiredVoteCount: state.requiredVoteCount,
    voteStatus: {
      votedCount: state.votedCount || 0,
      totalVoters: state.requiredVoteCount || 0,
      votedPlayerIndexes: view.actor && view.actor.voteStatus.submitted ? [actorSeat] : []
    },
    voteDeadlineMs: state.voteDeadlineAt && state.voteStartedAt
      ? state.voteDeadlineAt - state.voteStartedAt
      : null,
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
  const state = clientState || {};
  if (!view) {
    const lastError = state.error;
    return { ok: !lastError, roomId: state.roomId,
      errCode: lastError && lastError.errCode, errMsg: lastError && lastError.errMsg,
      revision: state.seq || 0, stateVersion: state.stateVersion || 0,
      members: [], memberCount: 0, roomState: null,
      view: null, ephemeral: state.ephemeral || {} };
  }
  const session = view.session;
  const clockOffsetMs = Number(state.serverClockOffsetMs) || 0;
  const projectedNow = Number(state.serverNow);
  const serverNow = Number.isFinite(projectedNow) ? projectedNow : Date.now();
  const members = pageMembers(view, state.historical);
  const roomState = {
    protocolVersion: PROTOCOL_VERSION,
    revision: state.seq || 0,
    stateVersion: state.stateVersion || 0,
    lifecycle: view.room.lifecycle,
    workflow: session && session.workflow,
    sessionId: session && session.sessionId || '',
    selectedModeId: session && modeId(session.mode),
    currentPage: routePageKey(view.route && view.route.name),
    brainstormSessionEnded: !!(session && session.status === 'COMPLETED'),
    selectedBG: session && session.setup.scenario,
    selectedDesignProblem: session && session.setup.selectedProblem,
    editingProblemId: '',
    memberCount: members.length
  };
  if (session && session.mode === MODE.PARTNER) {
    const turn = session.activeTurn;
    const closing = session.publicModeState.closing;
    const activeMember = turn && members.find((item) => item.memberId === turn.activeMemberId);
    const step = session.workflow.step;
    roomState.partnerGamePhase = step === WORKFLOW_STEP.PARTNER_STATEMENT ? 'discussion'
      : (PARTNER_CLOSING_STEPS.has(step) ? 'closing' : 'play');
    roomState.currentPlayerIndex = activeMember && activeMember.playerIndex;
    roomState.currentPlayerName = activeMember && activeMember.nickName;
    roomState.currentRound = turn ? turn.ordinal : session.publicModeState.turnOrdinal;
    roomState.partnerRoundNo = turn ? turn.roundNo : session.publicModeState.roundNo;
    // 旧页面计时器使用 Date.now()；在 PageModel 边界把服务端时间锚点换算到本机时钟域。
    roomState.partnerTurnStartedAt = turn && clientClockTimestamp(turn.turnStartedAt, clockOffsetMs);
    roomState.partnerRoundStartedAt = turn && clientClockTimestamp(turn.phaseStartedAt, clockOffsetMs);
    roomState.partnerMasterMode = !!(turn && turn.masterMode);
    roomState.partnerSilentMode = !!(turn && turn.silentDeadlineAt && turn.silentDeadlineAt > serverNow);
    roomState.partnerSilentStartedAt = turn && clientClockTimestamp(turn.silentStartedAt, clockOffsetMs);
    const silentSignal = state.ephemeral && state.ephemeral.signals
      && state.ephemeral.signals.PARTNER_SILENT_SOUND;
    const signalInCurrentScope = !!(silentSignal && turn
      && silentSignal.sessionId === session.sessionId
      && silentSignal.turnId === turn.turnId
      && Number(silentSignal.expiresAt) > serverNow);
    roomState.partnerSilentSoundLevel = signalInCurrentScope ? silentSignal.value : 0;
    // Domain 使用大写枚举，旧页面组件使用小写枚举；统一在 PageModel 边界转换。
    roomState.partnerClosingStep = partnerClosingStep(closing && closing.stage);
    roomState.closingVoteSessionId = closing && closing.closingVoteSessionId;
    roomState.closingVoteInitiatorIndex = closing && memberSeat(view, closing.initiatorMemberId);
    roomState.closingVoteSubmittedCount = closing && closing.votedCount;
    roomState.closingVoteRequiredCount = closing && closing.requiredCount;
    roomState.scoredCount = turn && turn.scoredCount || 0;
    roomState.totalRequired = turn && turn.requiredScoreCount || 0;
    const contextTurnId = (turn && turn.turnId) || (closing && closing.sourceTurnId) || null;
    roomState.progress = { scoredCount: roomState.scoredCount, requiredScoreCount: roomState.totalRequired,
      turnId: contextTurnId,
      domainTurnId: contextTurnId };
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
    roomState.partnerSpecialMovePreview = turn && turn.specialPreview || null;
    roomState.partnerSpecialMoveUsed = turn && turn.specialUsed || null;
  } else if (session && isHalliLikeMode(session.mode)) {
    roomState.currentPlayerIndex = memberSeat(view, session.publicModeState.firstMemberId);
    const first = members.find((item) => item.playerIndex === roomState.currentPlayerIndex);
    roomState.currentPlayerName = first && first.nickName || '';
  } else if (session && session.mode === MODE.SPY) {
    roomState.spyGame = spyPageState(view, session);
  }
  const editingSignal = state.ephemeral && state.ephemeral.signals
    && state.ephemeral.signals.DESIGN_PROBLEM_EDITING;
  if (session && session.workflow && session.workflow.step === WORKFLOW_STEP.SELECT_DESIGN_PROBLEM
    && editingSignal && editingSignal.sessionId === session.sessionId
    && Number(editingSignal.workflowRevision) === Number(session.workflow.revision)
    && Number(editingSignal.expiresAt) > serverNow
    && String(editingSignal.value || '')) {
    roomState.editingProblemId = String(editingSignal.value);
  }
  const result = {
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    roomId: view.room.roomId,
    revision: state.seq || 0,
    stateVersion: state.stateVersion || 0,
    isHost: view.actor.role === 'HOST',
    isParticipant: !!view.actor.isParticipant,
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
    ephemeral: state.ephemeral || {}
  };
  return result;
}

module.exports = { projectPageSnapshot, pageMembers, memberSeat };
