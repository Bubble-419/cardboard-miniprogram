'use strict';

const PROTOCOL_VERSION = 3;
const SCHEMA_VERSION = 3;
const VIEW_SCHEMA_VERSION = 1;
const EVENT_SCHEMA_VERSION = 1;
const MAX_SEATS = 6;

const LIFECYCLE = Object.freeze({ OPEN: 'OPEN', DISSOLVED: 'DISSOLVED' });
const SESSION_STATUS = Object.freeze({
  CONFIGURING: 'CONFIGURING', RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED'
});
const MODE = Object.freeze({ PARTNER: 'PARTNER', HALLI_GALLI: 'HALLI_GALLI', SPY: 'SPY' });
const WORKFLOW_STEP = Object.freeze({
  CHOOSE_SCENARIO: 'CHOOSE_SCENARIO',
  COLLECT_DESIGN_PROBLEMS: 'COLLECT_DESIGN_PROBLEMS',
  SELECT_DESIGN_PROBLEM: 'SELECT_DESIGN_PROBLEM',
  SELECT_FIRST_PLAYER: 'SELECT_FIRST_PLAYER',
  CONFIRM_FIRST_PLAYER: 'CONFIRM_FIRST_PLAYER',
  PARTNER_TURN: 'PARTNER_TURN',
  PARTNER_STATEMENT: 'PARTNER_STATEMENT',
  PARTNER_CLOSING_VOTE: 'PARTNER_CLOSING_VOTE',
  PARTNER_CLOSING_RUNE: 'PARTNER_CLOSING_RUNE',
  PARTNER_CLOSING_REVIEW: 'PARTNER_CLOSING_REVIEW',
  HALLI_ACTIVITY: 'HALLI_ACTIVITY',
  HALLI_CREATIVE: 'HALLI_CREATIVE',
  HALLI_SUMMARY: 'HALLI_SUMMARY',
  SPY_INTRO: 'SPY_INTRO',
  SPY_SPEAK: 'SPY_SPEAK',
  SPY_TIE_SPEAK: 'SPY_TIE_SPEAK',
  SPY_VOTE: 'SPY_VOTE',
  SPY_RESULT: 'SPY_RESULT',
  SPY_SETTLED: 'SPY_SETTLED'
});

const COMMAND_TYPES = Object.freeze({
  CREATE_ROOM: 'CREATE_ROOM', UPDATE_ROOM_PROFILE: 'UPDATE_ROOM_PROFILE', JOIN_ROOM: 'JOIN_ROOM',
  UPDATE_MEMBER_PROFILE: 'UPDATE_MEMBER_PROFILE', REORDER_SEATS: 'REORDER_SEATS', LEAVE_ROOM: 'LEAVE_ROOM',
  KICK_MEMBER: 'KICK_MEMBER', DISSOLVE_ROOM: 'DISSOLVE_ROOM', START_WORKSHOP_SESSION: 'START_WORKSHOP_SESSION',
  SET_SCENARIO: 'SET_SCENARIO', SUBMIT_DESIGN_PROBLEM: 'SUBMIT_DESIGN_PROBLEM',
  UPDATE_DESIGN_PROBLEM: 'UPDATE_DESIGN_PROBLEM', SELECT_DESIGN_PROBLEM: 'SELECT_DESIGN_PROBLEM',
  SELECT_FIRST_PLAYER: 'SELECT_FIRST_PLAYER', CONFIRM_FIRST_PLAYER: 'CONFIRM_FIRST_PLAYER',
  CANCEL_WORKSHOP_SESSION: 'CANCEL_WORKSHOP_SESSION', RETURN_TO_LOBBY: 'RETURN_TO_LOBBY',
  REPLAY_WORKSHOP_SESSION: 'REPLAY_WORKSHOP_SESSION', APPEND_ARTIFACT: 'APPEND_ARTIFACT',
  UPDATE_ARTIFACT: 'UPDATE_ARTIFACT', REMOVE_ARTIFACT: 'REMOVE_ARTIFACT',
  SUBMIT_PARTNER_SCORE: 'SUBMIT_PARTNER_SCORE', POST_PARTNER_MESSAGE: 'POST_PARTNER_MESSAGE',
  START_PARTNER_STATEMENT: 'START_PARTNER_STATEMENT', ADVANCE_PARTNER_TURN: 'ADVANCE_PARTNER_TURN',
  USE_PARTNER_SPECIAL: 'USE_PARTNER_SPECIAL', END_PARTNER_SILENT: 'END_PARTNER_SILENT',
  SUBMIT_PARTNER_CLOSING_VOTE: 'SUBMIT_PARTNER_CLOSING_VOTE',
  ADVANCE_PARTNER_CLOSING: 'ADVANCE_PARTNER_CLOSING', COMPLETE_PARTNER_SESSION: 'COMPLETE_PARTNER_SESSION',
  END_HALLI_ACTIVITY: 'END_HALLI_ACTIVITY', SUBMIT_HALLI_IDEA: 'SUBMIT_HALLI_IDEA',
  COMPLETE_HALLI_SESSION: 'COMPLETE_HALLI_SESSION', START_SPY_GAME: 'START_SPY_GAME',
  ADVANCE_SPY_SPEAKER: 'ADVANCE_SPY_SPEAKER', OPEN_SPY_VOTE: 'OPEN_SPY_VOTE',
  SUBMIT_SPY_VOTE: 'SUBMIT_SPY_VOTE', START_NEXT_SPY_ROUND: 'START_NEXT_SPY_ROUND',
  RESTART_SPY_GAME: 'RESTART_SPY_GAME', COMPLETE_SPY_SESSION: 'COMPLETE_SPY_SESSION'
});

const EVENT_TYPES = Object.freeze([
  'ROOM_CREATED', 'ROOM_PROFILE_UPDATED', 'ROOM_DISSOLVED', 'ROOM_RETURNED_TO_LOBBY',
  'MEMBER_JOINED', 'MEMBER_PROFILE_UPDATED', 'SEATS_REORDERED', 'MEMBER_LEFT', 'MEMBER_KICKED',
  'WORKSHOP_SESSION_STARTED', 'WORKSHOP_SESSION_CANCELLED', 'WORKSHOP_SESSION_REPLAYED',
  'WORKSHOP_SESSION_COMPLETED', 'SCENARIO_SET', 'DESIGN_PROBLEM_SUBMITTED', 'DESIGN_PROBLEM_UPDATED',
  'DESIGN_PROBLEM_SELECTED', 'PROBLEM_COLLECTION_COMPLETED', 'FIRST_PLAYER_SELECTED',
  'PARTNER_TURN_STARTED', 'PARTNER_TURN_COMPLETED', 'PARTNER_TURN_ABANDONED',
  'PARTNER_SCORE_RECORDED', 'PARTNER_STATEMENT_STARTED', 'PARTNER_SPECIAL_USED',
  'PARTNER_SILENT_ENDED', 'PARTNER_CLOSING_VOTE_STARTED', 'PARTNER_CLOSING_VOTE_RECORDED',
  'PARTNER_CLOSING_QUESTIONED', 'PARTNER_CLOSING_ACCEPTED', 'PARTNER_CLOSING_REVIEW_STARTED',
  'ARTIFACT_APPENDED', 'ARTIFACT_UPDATED', 'ARTIFACT_REMOVED', 'PARTNER_MESSAGE_POSTED',
  'HALLI_CREATIVE_STARTED', 'HALLI_IDEA_SUBMITTED', 'HALLI_SUMMARY_READY', 'SPY_ROLES_ASSIGNED',
  'SPY_SPEAKER_STARTED', 'SPY_SPEAKER_FINISHED', 'SPY_VOTE_OPENED', 'SPY_VOTE_RECORDED',
  'SPY_VOTE_TIED', 'SPY_PLAYER_ELIMINATED', 'SPY_ROUND_COMPLETED', 'SPY_ROUND_STARTED',
  'SPY_GAME_SETTLED', 'SPY_GAME_RESTARTED'
].reduce((out, type) => { out[type] = type; return out; }, {}));

const ERR = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT', UNAUTHENTICATED: 'UNAUTHENTICATED', ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_DISSOLVED: 'ROOM_DISSOLVED', ALREADY_IN_ROOM: 'ALREADY_IN_ROOM', ROOM_FULL: 'ROOM_FULL',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED', NOT_MEMBER: 'NOT_MEMBER', NOT_PARTICIPANT: 'NOT_PARTICIPANT',
  HOST_REQUIRED: 'HOST_REQUIRED', HOST_CANNOT_LEAVE: 'HOST_CANNOT_LEAVE', STALE_CONTEXT: 'STALE_CONTEXT',
  INVALID_TRANSITION: 'INVALID_TRANSITION', SELF_SCORE: 'SELF_SCORE', ALREADY_VOTED: 'ALREADY_VOTED',
  COMMAND_ID_CONFLICT: 'COMMAND_ID_CONFLICT', RATE_LIMITED: 'RATE_LIMITED',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE', INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS', NO_WORD_PAIR: 'NO_WORD_PAIR', SNAPSHOT_REQUIRED: 'SNAPSHOT_REQUIRED'
});

const ERR_MSG = Object.freeze({
  [ERR.INVALID_ARGUMENT]: '参数不合法', [ERR.UNAUTHENTICATED]: '未登录', [ERR.ROOM_NOT_FOUND]: '房间不存在',
  [ERR.ROOM_DISSOLVED]: '房间已解散', [ERR.ALREADY_IN_ROOM]: '已经加入其他房间', [ERR.ROOM_FULL]: '房间已满',
  [ERR.LIMIT_EXCEEDED]: '内容超过上限', [ERR.NOT_MEMBER]: '非房间成员',
  [ERR.NOT_PARTICIPANT]: '不是当前场次参与者', [ERR.HOST_REQUIRED]: '仅房主可操作',
  [ERR.HOST_CANNOT_LEAVE]: '房主请使用解散房间', [ERR.STALE_CONTEXT]: '操作上下文已过期',
  [ERR.INVALID_TRANSITION]: '当前步骤不允许该操作', [ERR.SELF_SCORE]: '当前行动者无需评分',
  [ERR.ALREADY_VOTED]: '已经提交过投票', [ERR.COMMAND_ID_CONFLICT]: 'commandId 冲突',
  [ERR.RATE_LIMITED]: '请求过于频繁', [ERR.DEPENDENCY_UNAVAILABLE]: '依赖暂时不可用',
  [ERR.INTERNAL_ERROR]: '服务异常', [ERR.NOT_ENOUGH_PLAYERS]: '人数不足', [ERR.NO_WORD_PAIR]: '词库为空',
  [ERR.SNAPSHOT_REQUIRED]: '需要重新获取快照'
});

const COMMAND_CONTEXT = Object.freeze({
  SET_SCENARIO: ['sessionId'], SUBMIT_DESIGN_PROBLEM: ['sessionId'],
  UPDATE_DESIGN_PROBLEM: ['sessionId', 'entityVersion'], SELECT_DESIGN_PROBLEM: ['sessionId'],
  SELECT_FIRST_PLAYER: ['sessionId'], CONFIRM_FIRST_PLAYER: ['sessionId'],
  CANCEL_WORKSHOP_SESSION: ['sessionId'], RETURN_TO_LOBBY: ['sessionId'], REPLAY_WORKSHOP_SESSION: ['sessionId'],
  APPEND_ARTIFACT: ['sessionId', 'turnId'], UPDATE_ARTIFACT: ['sessionId', 'turnId', 'entityVersion'],
  REMOVE_ARTIFACT: ['sessionId', 'turnId', 'entityVersion'], SUBMIT_PARTNER_SCORE: ['sessionId', 'turnId'],
  POST_PARTNER_MESSAGE: ['sessionId', 'turnId'], START_PARTNER_STATEMENT: ['sessionId', 'turnId'],
  ADVANCE_PARTNER_TURN: ['sessionId', 'turnId'], USE_PARTNER_SPECIAL: ['sessionId', 'turnId'],
  END_PARTNER_SILENT: ['sessionId', 'turnId'],
  SUBMIT_PARTNER_CLOSING_VOTE: ['sessionId', 'closingVoteSessionId'], ADVANCE_PARTNER_CLOSING: ['sessionId'],
  COMPLETE_PARTNER_SESSION: ['sessionId'], END_HALLI_ACTIVITY: ['sessionId'], SUBMIT_HALLI_IDEA: ['sessionId'],
  COMPLETE_HALLI_SESSION: ['sessionId'], START_SPY_GAME: ['sessionId'],
  ADVANCE_SPY_SPEAKER: ['sessionId', 'gameId', 'speakerTurnId'], OPEN_SPY_VOTE: ['sessionId', 'gameId'],
  SUBMIT_SPY_VOTE: ['sessionId', 'gameId', 'voteSessionId'], START_NEXT_SPY_ROUND: ['sessionId', 'gameId'],
  RESTART_SPY_GAME: ['sessionId', 'gameId'], COMPLETE_SPY_SESSION: ['sessionId', 'gameId']
});

function fail(errCode, errMsg, extra) {
  return { ok: false, errCode, errMsg: errMsg || ERR_MSG[errCode] || errCode,
    retryable: errCode === ERR.DEPENDENCY_UNAVAILABLE || errCode === ERR.RATE_LIMITED, ...(extra || {}) };
}
function okResult(fields) { return { ok: true, ...(fields || {}) }; }
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function normalizeMode(value) {
  return ({ partner: MODE.PARTNER, PARTNER: MODE.PARTNER, halliGalli: MODE.HALLI_GALLI,
    HALLI_GALLI: MODE.HALLI_GALLI, spy: MODE.SPY, SPY: MODE.SPY })[String(value || '').trim()] || null;
}

function validatePayload(type, payload) {
  if (type === COMMAND_TYPES.START_WORKSHOP_SESSION && !normalizeMode(payload.mode)) {
    return fail(ERR.INVALID_ARGUMENT, 'mode 必须是 PARTNER、HALLI_GALLI 或 SPY');
  }
  if (type === COMMAND_TYPES.SUBMIT_PARTNER_SCORE) {
    const steps = Number(payload.scoreHalfSteps);
    if (!Number.isInteger(steps) || steps < 0 || steps > 10) return fail(ERR.INVALID_ARGUMENT, 'scoreHalfSteps 必须是 0～10 的整数');
  }
  const textLimits = {
    [COMMAND_TYPES.POST_PARTNER_MESSAGE]: ['text', 40, '消息'],
    [COMMAND_TYPES.SUBMIT_DESIGN_PROBLEM]: ['text', 50, '设计问题'],
    [COMMAND_TYPES.SUBMIT_HALLI_IDEA]: ['text', 120, '创意']
  };
  if (textLimits[type]) {
    const [field, limit, label] = textLimits[type];
    const text = String(payload[field] || '').trim();
    if (!text) return fail(ERR.INVALID_ARGUMENT, `${label}不能为空`);
    if (text.length > limit) return fail(ERR.LIMIT_EXCEEDED, `${label}最多 ${limit} 字`);
  }
  if (type === COMMAND_TYPES.SUBMIT_PARTNER_CLOSING_VOTE && !['pass', 'question'].includes(payload.vote)) {
    return fail(ERR.INVALID_ARGUMENT, 'vote 必须是 pass 或 question');
  }
  if (type === COMMAND_TYPES.USE_PARTNER_SPECIAL && !['HELP_LUCK', 'SILENT', 'MASTER', 'CLOSING'].includes(payload.kind)) {
    return fail(ERR.INVALID_ARGUMENT, '未知特殊行动');
  }
  return okResult();
}

function validateCommandEnvelope(raw) {
  if (!raw || typeof raw !== 'object') return fail(ERR.INVALID_ARGUMENT, 'command envelope 必填');
  if (Number(raw.protocolVersion) !== PROTOCOL_VERSION) return fail(ERR.INVALID_ARGUMENT, `仅支持 protocolVersion=${PROTOCOL_VERSION}`);
  const type = String(raw.type || '');
  if (!Object.values(COMMAND_TYPES).includes(type)) return fail(ERR.INVALID_ARGUMENT, `未知命令类型: ${type}`);
  if (!isNonEmptyString(raw.commandId) || raw.commandId.trim().length > 128) return fail(ERR.INVALID_ARGUMENT, 'commandId 必须是 1～128 字符');
  if (type !== COMMAND_TYPES.CREATE_ROOM && !isNonEmptyString(raw.roomId)) return fail(ERR.INVALID_ARGUMENT, 'roomId 必填');
  const knownSeq = raw.knownSeq == null ? 0 : Number(raw.knownSeq);
  if (!Number.isInteger(knownSeq) || knownSeq < 0) return fail(ERR.INVALID_ARGUMENT, 'knownSeq 必须是非负整数');
  const context = raw.context && typeof raw.context === 'object' ? raw.context : {};
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  for (const key of COMMAND_CONTEXT[type] || []) {
    if (context[key] == null || context[key] === '') return fail(ERR.INVALID_ARGUMENT, `context.${key} 必填`);
  }
  const payloadResult = validatePayload(type, payload);
  if (!payloadResult.ok) return payloadResult;
  return okResult({ envelope: { protocolVersion: PROTOCOL_VERSION, commandId: raw.commandId.trim(),
    roomId: isNonEmptyString(raw.roomId) ? raw.roomId.trim() : '', knownSeq, type, context: { ...context },
    payload: { ...payload }, clientSentAt: Number.isFinite(Number(raw.clientSentAt)) ? Number(raw.clientSentAt) : null } });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

module.exports = { PROTOCOL_VERSION, SCHEMA_VERSION, VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION, MAX_SEATS,
  LIFECYCLE, SESSION_STATUS, MODE, WORKFLOW_STEP, COMMAND_TYPES, EVENT_TYPES, ERR, ERR_MSG, COMMAND_CONTEXT,
  fail, okResult, isNonEmptyString, normalizeMode, validateCommandEnvelope, stableStringify };
