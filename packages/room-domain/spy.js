'use strict';

const { COMMAND_TYPES, SPY_VOTE_DURATION_MS } = require('@cardboard/room-contracts');
const { SPY_WORD_PAIRS } = require('./spyWordPairs');
const {
  clone, event, domainOk, fail, idOf, nowOf, ensureFacts, assertHost, assertParticipant, assertSession,
  activeParticipantsBySeat, progressComplete, MODE, SESSION_STATUS, WORKFLOW_STEP, EVENT_TYPES, ERR
} = require('./model');

function randomOf(deps) { return deps && typeof deps.random === 'function' ? deps.random : Math.random; }
function shuffle(items, random) {
  const list = items.slice();
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
function spyState(aggregate) { return aggregate.currentSession && aggregate.currentSession.modeState.spy; }
function alivePlayers(spy) { return (spy.players || []).filter((player) => player.alive && !player.left); }
function playerByMemberId(spy, memberId) { return (spy.players || []).find((player) => player.memberId === memberId) || null; }
function secretByMemberId(aggregate, gameId, memberId) {
  return ensureFacts(aggregate).secrets[`${gameId}:${memberId}`] || null;
}
function winnerSide(aggregate, spy) {
  const alive = alivePlayers(spy);
  const spies = alive.filter((player) => (secretByMemberId(aggregate, spy.gameId, player.memberId) || {}).role === 'spy');
  const civilians = alive.length - spies.length;
  if (!spies.length) return 'civilian';
  if (spies.length >= civilians) return 'spy';
  return null;
}
function reveal(aggregate, spy) {
  return (spy.players || []).map((player) => {
    const secret = secretByMemberId(aggregate, spy.gameId, player.memberId) || {};
    return { memberId: player.memberId, nickName: player.nickName, role: secret.role || null,
      word: secret.word || null, alive: player.alive, left: player.left };
  });
}
function pickWords(deps) {
  if (deps && typeof deps.wordPairPicker === 'function') return deps.wordPairPicker(randomOf(deps));
  if (!SPY_WORD_PAIRS.length) return null;
  const random = randomOf(deps);
  const pair = SPY_WORD_PAIRS[Math.floor(random() * SPY_WORD_PAIRS.length)];
  const swap = random() < 0.5;
  return { id: pair.id, civilianWord: swap ? pair.wordB : pair.wordA, civilianBlurb: swap ? pair.blurbB : pair.blurbA,
    spyWord: swap ? pair.wordA : pair.wordB, spyBlurb: swap ? pair.blurbA : pair.blurbB };
}
function startSpeaker(aggregate, order, deps, tieBreak) {
  const session = aggregate.currentSession; const spy = spyState(aggregate);
  spy.speakOrder = order.slice(); spy.currentSpeakerIndex = 0; spy.speakerTurnId = idOf(deps, 'speaker');
  spy.speakRoundStartedAt = nowOf(deps); spy.speakTurnStartedAt = nowOf(deps); spy.voteProgress = null;
  spy.tieBreak = tieBreak === true;
  session.workflow = { step: tieBreak ? WORKFLOW_STEP.SPY_TIE_SPEAK : WORKFLOW_STEP.SPY_SPEAK,
    roundNo: spy.roundNo, activeMemberId: order[0] || null, turnId: spy.speakerTurnId, phaseStartedAt: nowOf(deps) };
  return event(EVENT_TYPES.SPY_SPEAKER_STARTED, { speakerTurnId: spy.speakerTurnId, memberId: order[0] || null, tieBreak: spy.tieBreak });
}
function openVote(aggregate, deps) {
  const session = aggregate.currentSession; const spy = spyState(aggregate);
  const requiredMemberIds = alivePlayers(spy).map((player) => player.memberId);
  spy.voteProgress = { voteSessionId: idOf(deps, 'vote'), requiredMemberIds, submittedMemberIds: [] };
  spy.voteStartedAt = nowOf(deps);
  session.workflow = { step: WORKFLOW_STEP.SPY_VOTE, roundNo: spy.roundNo, activeMemberId: null,
    turnId: spy.voteProgress.voteSessionId, phaseStartedAt: nowOf(deps) };
  return event(EVENT_TYPES.SPY_VOTE_OPENED, { voteSessionId: spy.voteProgress.voteSessionId, requiredCount: requiredMemberIds.length, tieBreak: spy.tieBreak });
}
function startGame(aggregate, deps, restarted) {
  const session = aggregate.currentSession; const facts = ensureFacts(aggregate);
  const previousGameId = restarted && session.modeState.spy && session.modeState.spy.gameId;
  const deletedFacts = [];
  if (previousGameId) {
    Object.entries(facts.secrets).forEach(([key, row]) => {
      if (row.gameId !== previousGameId) return;
      delete facts.secrets[key];
      deletedFacts.push({ kind: 'secrets', id: key, remove: true });
    });
  }
  const participants = activeParticipantsBySeat(aggregate);
  if (participants.length < 3) return fail(ERR.NOT_ENOUGH_PLAYERS, 'Spy 至少需要 3 人');
  const words = pickWords(deps); if (!words) return fail(ERR.NO_WORD_PAIR);
  const random = randomOf(deps); const shuffled = shuffle(participants, random); const spyMemberId = shuffled[0].memberId;
  const gameId = idOf(deps, 'spy');
  const players = participants.map((member) => ({ memberId: member.memberId, seatNoAtStart: member.seatNo,
    nickName: member.profile.nickName, avatarRef: member.profile.avatarRef || null, alive: true, left: false }));
  players.forEach((player) => {
    const isSpy = player.memberId === spyMemberId; const key = `${gameId}:${player.memberId}`;
    facts.secrets[key] = { gameId, sessionId: session.sessionId, memberId: player.memberId,
      role: isSpy ? 'spy' : 'civilian', word: isSpy ? words.spyWord : words.civilianWord,
      blurb: isSpy ? words.spyBlurb : words.civilianBlurb, createdAt: nowOf(deps) };
  });
  session.modeState.spy = { gameId, roundNo: 1, wordPairId: words.id || null, players, speakOrder: [],
    currentSpeakerIndex: 0, speakerTurnId: null, voteProgress: null, voteStartedAt: null, tieBreak: false,
    lastResult: null, winnerSide: null, reveal: [] };
  session.status = SESSION_STATUS.RUNNING;
  const events = [];
  if (restarted) events.push(event(EVENT_TYPES.SPY_GAME_RESTARTED, { gameId }));
  events.push(event(EVENT_TYPES.SPY_ROLES_ASSIGNED, { gameId, playerCount: players.length, spyCount: 1 }));
  events.push(startSpeaker(aggregate, shuffle(players.map((player) => player.memberId), random), deps, false));
  return domainOk(aggregate, events, { kind: 'ACCEPTED', gameId },
    deletedFacts.concat(players.map((player) => ({ kind: 'secrets', id: `${gameId}:${player.memberId}` }))));
}
function assertSpy(aggregate, context, steps) {
  const check = assertSession(aggregate, context, { mode: MODE.SPY, steps });
  if (!check.ok) return check;
  const spy = spyState(aggregate);
  if (!spy || (context.gameId && spy.gameId !== context.gameId)) return fail(ERR.STALE_CONTEXT, 'Spy 游戏已经变化');
  return { ...check, spy };
}
function resolveVote(aggregate, deps) {
  const session = aggregate.currentSession; const spy = spyState(aggregate); const facts = ensureFacts(aggregate);
  const requiredVoters = new Set(spy.voteProgress.requiredMemberIds);
  const validTargets = new Set(alivePlayers(spy).map((player) => player.memberId));
  const rows = Object.values(facts.votes).filter((row) => row.voteSessionId === spy.voteProgress.voteSessionId
    && requiredVoters.has(row.memberId));
  const tally = {};
  rows.forEach((row) => {
    if (row.targetMemberId && validTargets.has(row.targetMemberId)) {
      tally[row.targetMemberId] = (tally[row.targetMemberId] || 0) + 1;
    }
  });
  const max = Math.max(0, ...Object.values(tally));
  const top = max ? Object.keys(tally).filter((memberId) => tally[memberId] === max) : [];
  if (top.length > 1) {
    spy.lastResult = { eliminatedMemberId: null, maxVotes: max, tied: true, tiedMemberIds: top, tallies: tally, winnerSide: null };
    const started = startSpeaker(aggregate, shuffle(top, randomOf(deps)), deps, true);
    return [event(EVENT_TYPES.SPY_VOTE_TIED, { memberIds: top, maxVotes: max }), started];
  }
  let eliminated = null;
  if (top.length === 1) {
    eliminated = playerByMemberId(spy, top[0]);
    if (eliminated) eliminated.alive = false;
  }
  const winner = winnerSide(aggregate, spy);
  const eliminatedSecret = eliminated ? secretByMemberId(aggregate, spy.gameId, eliminated.memberId) : null;
  spy.lastResult = { eliminatedMemberId: eliminated && eliminated.memberId,
    eliminatedName: eliminated && eliminated.nickName,
    eliminatedRole: eliminatedSecret && eliminatedSecret.role,
    maxVotes: max, tied: false, tallies: tally, winnerSide: winner };
  const events = [];
  if (eliminated) events.push(event(EVENT_TYPES.SPY_PLAYER_ELIMINATED,
    { memberId: eliminated.memberId, nickName: eliminated.nickName, maxVotes: max }));
  if (winner) {
    spy.winnerSide = winner; spy.reveal = reveal(aggregate, spy);
    session.workflow.step = WORKFLOW_STEP.SPY_SETTLED; session.workflow.activeMemberId = null;
    session.workflow.turnId = null; session.workflow.phaseStartedAt = nowOf(deps);
    events.push(event(EVENT_TYPES.SPY_GAME_SETTLED, { winnerSide: winner, reveal: clone(spy.reveal) }));
  } else {
    session.workflow.step = WORKFLOW_STEP.SPY_RESULT; session.workflow.activeMemberId = null;
    session.workflow.turnId = null; session.workflow.phaseStartedAt = nowOf(deps);
    events.push(event(EVENT_TYPES.SPY_ROUND_COMPLETED, { roundNo: spy.roundNo, eliminatedMemberId: eliminated && eliminated.memberId, tallies: tally }));
  }
  return events;
}

function reduceSpyCommand(aggregate, command, actorUserId, deps) {
  if (command.type === COMMAND_TYPES.START_SPY_GAME) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSession(aggregate, command.context, { mode: MODE.SPY, steps: [WORKFLOW_STEP.SPY_INTRO] });
    if (!check.ok) return check;
    return startGame(aggregate, deps, false);
  }
  const actor = assertParticipant(aggregate, actorUserId); if (!actor.ok) return actor;

  if (command.type === COMMAND_TYPES.ADVANCE_SPY_SPEAKER) {
    const check = assertSpy(aggregate, command.context, [WORKFLOW_STEP.SPY_SPEAK, WORKFLOW_STEP.SPY_TIE_SPEAK]); if (!check.ok) return check;
    if (check.spy.speakerTurnId !== command.context.speakerTurnId) return fail(ERR.STALE_CONTEXT, '发言轮已经变化');
    const current = check.spy.speakOrder[check.spy.currentSpeakerIndex];
    if (current !== actor.member.memberId) return fail(ERR.INVALID_TRANSITION, '仅当前发言者可以结束发言');
    const events = [event(EVENT_TYPES.SPY_SPEAKER_FINISHED, { speakerTurnId: check.spy.speakerTurnId, memberId: current })];
    check.spy.currentSpeakerIndex += 1;
    while (check.spy.currentSpeakerIndex < check.spy.speakOrder.length) {
      const player = playerByMemberId(check.spy, check.spy.speakOrder[check.spy.currentSpeakerIndex]);
      if (player && player.alive && !player.left) break;
      check.spy.currentSpeakerIndex += 1;
    }
    if (check.spy.currentSpeakerIndex >= check.spy.speakOrder.length) events.push(openVote(aggregate, deps));
    else {
      check.spy.speakerTurnId = idOf(deps, 'speaker'); check.spy.speakTurnStartedAt = nowOf(deps);
      check.session.workflow.activeMemberId = check.spy.speakOrder[check.spy.currentSpeakerIndex];
      check.session.workflow.turnId = check.spy.speakerTurnId; check.session.workflow.phaseStartedAt = nowOf(deps);
      events.push(event(EVENT_TYPES.SPY_SPEAKER_STARTED, { speakerTurnId: check.spy.speakerTurnId,
        memberId: check.session.workflow.activeMemberId, tieBreak: check.spy.tieBreak }));
    }
    return domainOk(aggregate, events);
  }

  if (command.type === COMMAND_TYPES.OPEN_SPY_VOTE) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSpy(aggregate, command.context, [WORKFLOW_STEP.SPY_SPEAK, WORKFLOW_STEP.SPY_TIE_SPEAK]); if (!check.ok) return check;
    if (check.spy.speakerTurnId !== command.context.speakerTurnId) {
      return fail(ERR.STALE_CONTEXT, '发言轮已经变化');
    }
    return domainOk(aggregate, [openVote(aggregate, deps)]);
  }

  if (command.type === COMMAND_TYPES.SUBMIT_SPY_VOTE) {
    const check = assertSpy(aggregate, command.context, [WORKFLOW_STEP.SPY_VOTE]); if (!check.ok) return check;
    const progress = check.spy.voteProgress;
    if (!progress || progress.voteSessionId !== command.context.voteSessionId) return fail(ERR.STALE_CONTEXT, '投票场次已经变化');
    const player = playerByMemberId(check.spy, actor.member.memberId);
    if (!player || !player.alive || player.left) return fail(ERR.INVALID_TRANSITION, '出局成员不能投票');
    if (progress.submittedMemberIds.includes(actor.member.memberId)) return fail(ERR.ALREADY_VOTED);
    // 截止时间由服务端时钟裁决；迟到的目标票统一按弃票记录，客户端倒计时只负责展示。
    const voteExpired = check.spy.voteStartedAt != null
      && nowOf(deps) >= Number(check.spy.voteStartedAt) + SPY_VOTE_DURATION_MS;
    const abstain = command.payload.abstain === true || voteExpired;
    const targetMemberId = abstain ? null : String(command.payload.targetMemberId || '');
    if (!abstain) {
      if (!targetMemberId || targetMemberId === actor.member.memberId) return fail(ERR.INVALID_ARGUMENT, '请选择其他存活成员');
      const target = playerByMemberId(check.spy, targetMemberId);
      if (!target || !target.alive || target.left) return fail(ERR.INVALID_ARGUMENT, '投票目标不可用');
      if (check.spy.tieBreak) {
        const tiedMemberIds = (check.spy.lastResult && check.spy.lastResult.tiedMemberIds) || [];
        if (!tiedMemberIds.includes(targetMemberId)) {
          return fail(ERR.INVALID_ARGUMENT, '加时只能投并列成员');
        }
      }
    }
    const facts = ensureFacts(aggregate); const key = `${progress.voteSessionId}:${actor.member.memberId}`;
    facts.votes[key] = { sessionId: check.session.sessionId, gameId: check.spy.gameId,
      voteSessionId: progress.voteSessionId,
      memberId: actor.member.memberId, vote: abstain ? 'abstain' : 'target', targetMemberId, createdAt: nowOf(deps) };
    progress.submittedMemberIds.push(actor.member.memberId);
    const events = [event(EVENT_TYPES.SPY_VOTE_RECORDED, { voteSessionId: progress.voteSessionId,
      votedCount: progress.submittedMemberIds.length, requiredCount: progress.requiredMemberIds.length })];
    if (progressComplete(progress)) events.push(...resolveVote(aggregate, deps));
    return domainOk(aggregate, events, { kind: 'ACCEPTED' }, [{ kind: 'votes', id: key }]);
  }

  if (command.type === COMMAND_TYPES.START_NEXT_SPY_ROUND) {
    const check = assertSpy(aggregate, command.context, [WORKFLOW_STEP.SPY_RESULT]); if (!check.ok) return check;
    if (check.spy.roundNo !== command.context.roundNo) return fail(ERR.STALE_CONTEXT, 'Spy 轮次已经变化');
    const alive = alivePlayers(check.spy);
    if (alive.length < 2) return fail(ERR.INVALID_TRANSITION, '存活人数不足');
    const previousResult = check.spy.lastResult;
    check.spy.roundNo += 1; check.spy.lastResult = null; check.spy.voteProgress = null; check.spy.tieBreak = false;
    let order = alive.slice().sort((a, b) => a.seatNoAtStart - b.seatNoAtStart).map((player) => player.memberId);
    const eliminated = check.spy.players.find((player) => !player.alive && previousResult && player.memberId === previousResult.eliminatedMemberId);
    if (eliminated) {
      const index = order.findIndex((memberId) => playerByMemberId(check.spy, memberId).seatNoAtStart > eliminated.seatNoAtStart);
      if (index > 0) order = order.slice(index).concat(order.slice(0, index));
    }
    const events = [event(EVENT_TYPES.SPY_ROUND_STARTED, { roundNo: check.spy.roundNo }), startSpeaker(aggregate, order, deps, false)];
    return domainOk(aggregate, events);
  }

  if (command.type === COMMAND_TYPES.RESTART_SPY_GAME) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSpy(aggregate, command.context, [WORKFLOW_STEP.SPY_SETTLED]); if (!check.ok) return check;
    return startGame(aggregate, deps, true);
  }

  if (command.type === COMMAND_TYPES.COMPLETE_SPY_SESSION) {
    const host = assertHost(aggregate, actorUserId); if (!host.ok) return host;
    const check = assertSpy(aggregate, command.context, [WORKFLOW_STEP.SPY_SETTLED]); if (!check.ok) return check;
    check.session.status = SESSION_STATUS.COMPLETED; check.session.completedAt = nowOf(deps);
    check.session.result = { mode: MODE.SPY, winnerSide: check.spy.winnerSide, reveal: clone(check.spy.reveal) };
    return domainOk(aggregate, [event(EVENT_TYPES.WORKSHOP_SESSION_COMPLETED, { sessionId: check.session.sessionId, mode: MODE.SPY })]);
  }

  return fail(ERR.INVALID_ARGUMENT, `未实现的 Spy 命令: ${command.type}`);
}

function handleSpyParticipantLeft(aggregate, memberId, deps) {
  const session = aggregate.currentSession; const spy = spyState(aggregate); const events = [];
  if (!session || session.mode !== MODE.SPY || !spy) return { events, dirtyFacts: [] };
  const player = playerByMemberId(spy, memberId); if (!player) return { events, dirtyFacts: [] };
  player.left = true; player.alive = false;
  if (spy.voteProgress) {
    spy.voteProgress.requiredMemberIds = spy.voteProgress.requiredMemberIds.filter((id) => id !== memberId);
    spy.voteProgress.submittedMemberIds = spy.voteProgress.submittedMemberIds.filter((id) => id !== memberId);
    if (session.workflow.step === WORKFLOW_STEP.SPY_VOTE
      && progressComplete(spy.voteProgress)) {
      events.push(...resolveVote(aggregate, deps));
      return { events, dirtyFacts: [] };
    }
  }
  const winner = winnerSide(aggregate, spy);
  if (winner && session.workflow.step !== WORKFLOW_STEP.SPY_SETTLED) {
    spy.winnerSide = winner; spy.reveal = reveal(aggregate, spy); session.workflow.step = WORKFLOW_STEP.SPY_SETTLED;
    session.workflow.activeMemberId = null; session.workflow.turnId = null; session.workflow.phaseStartedAt = nowOf(deps);
    events.push(event(EVENT_TYPES.SPY_GAME_SETTLED, { winnerSide: winner, reveal: clone(spy.reveal) }));
    return { events, dirtyFacts: [] };
  }
  const current = spy.speakOrder[spy.currentSpeakerIndex];
  if ([WORKFLOW_STEP.SPY_SPEAK, WORKFLOW_STEP.SPY_TIE_SPEAK].includes(session.workflow.step) && current === memberId) {
    spy.currentSpeakerIndex += 1;
    while (spy.currentSpeakerIndex < spy.speakOrder.length) {
      const next = playerByMemberId(spy, spy.speakOrder[spy.currentSpeakerIndex]);
      if (next && next.alive && !next.left) break;
      spy.currentSpeakerIndex += 1;
    }
    if (spy.currentSpeakerIndex >= spy.speakOrder.length) events.push(openVote(aggregate, deps));
    else {
      const now = nowOf(deps);
      spy.speakerTurnId = idOf(deps, 'speaker'); spy.speakTurnStartedAt = now;
      session.workflow.activeMemberId = spy.speakOrder[spy.currentSpeakerIndex];
      session.workflow.turnId = spy.speakerTurnId;
      session.workflow.phaseStartedAt = now;
      events.push(event(EVENT_TYPES.SPY_SPEAKER_STARTED, { speakerTurnId: spy.speakerTurnId, memberId: session.workflow.activeMemberId, tieBreak: spy.tieBreak }));
    }
  }
  return { events, dirtyFacts: [] };
}

function publicSpyGame(spy) {
  if (!spy) return null;
  return { gameId: spy.gameId, roundNo: spy.roundNo, players: clone(spy.players), speakOrder: clone(spy.speakOrder),
    currentSpeakerIndex: spy.currentSpeakerIndex, speakerTurnId: spy.speakerTurnId,
    voteProgress: spy.voteProgress ? { voteSessionId: spy.voteProgress.voteSessionId,
      submittedCount: spy.voteProgress.submittedMemberIds.length, requiredCount: spy.voteProgress.requiredMemberIds.length } : null,
    tieBreak: spy.tieBreak, lastResult: clone(spy.lastResult), winnerSide: spy.winnerSide,
    reveal: spy.winnerSide ? clone(spy.reveal) : [] };
}

module.exports = { reduceSpyCommand, handleSpyParticipantLeft, publicSpyGame, winnerSide, shuffle };
