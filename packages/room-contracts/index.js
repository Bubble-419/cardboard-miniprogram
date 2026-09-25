'use strict';

const PROTOCOL_VERSION = 3;
const SCHEMA_VERSION = 6;
const VIEW_SCHEMA_VERSION = 11;
const EVENT_SCHEMA_VERSION = 5;
const MAX_INCREMENTAL_SYNC_EVENTS = 25;
const MAX_SEATS = 6;
const MAX_SESSION_MESSAGES = 500;
const MAX_SESSION_ARTIFACTS = 1000;
const MAX_PARTNER_TURNS = 200;
const MAX_SESSION_DOCUMENT_BYTES = 6 * 1024 * 1024;
// 为 Cloud Function 响应封装、瞬时态和 JSON 元数据预留空间，事件批次控制在 512 KiB 内。
const MAX_SYNC_RESPONSE_BYTES = 512 * 1024;
const SPY_VOTE_DURATION_MS = 2 * 60 * 1000;

const LIFECYCLE = Object.freeze({ OPEN: 'OPEN', DISSOLVED: 'DISSOLVED' });
const SESSION_STATUS = Object.freeze({
  CONFIGURING: 'CONFIGURING', RUNNING: 'RUNNING', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED'
});
const MODE = Object.freeze({
  PARTNER: 'PARTNER',
  GAN_DENG_YAN: 'GAN_DENG_YAN',
  HALLI_GALLI: 'HALLI_GALLI',
  SPY: 'SPY'
});
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

// Reducer 与 View capability 共用同一组步骤集合，避免两端各自维护后发生漂移。
const WORKFLOW_GROUPS = Object.freeze({
  SCENARIO_CONFIG: Object.freeze([
    WORKFLOW_STEP.CHOOSE_SCENARIO,
    WORKFLOW_STEP.COLLECT_DESIGN_PROBLEMS,
    WORKFLOW_STEP.SELECT_DESIGN_PROBLEM,
    WORKFLOW_STEP.SELECT_FIRST_PLAYER,
    WORKFLOW_STEP.CONFIRM_FIRST_PLAYER
  ]),
  PROBLEM_SELECTION: Object.freeze([
    WORKFLOW_STEP.SELECT_DESIGN_PROBLEM,
    WORKFLOW_STEP.SELECT_FIRST_PLAYER,
    WORKFLOW_STEP.CONFIRM_FIRST_PLAYER
  ]),
  FIRST_PLAYER_SELECTION: Object.freeze([
    WORKFLOW_STEP.SELECT_FIRST_PLAYER,
    WORKFLOW_STEP.CONFIRM_FIRST_PLAYER
  ])
});

const COMMAND_TYPES = Object.freeze({
  CREATE_ROOM: 'CREATE_ROOM', UPDATE_ROOM_PROFILE: 'UPDATE_ROOM_PROFILE', JOIN_ROOM: 'JOIN_ROOM',
  UPDATE_MEMBER_PROFILE: 'UPDATE_MEMBER_PROFILE', REORDER_SEATS: 'REORDER_SEATS', LEAVE_ROOM: 'LEAVE_ROOM',
  KICK_MEMBER: 'KICK_MEMBER', DISSOLVE_ROOM: 'DISSOLVE_ROOM', BEGIN_MODE_SELECTION: 'BEGIN_MODE_SELECTION',
  CANCEL_MODE_SELECTION: 'CANCEL_MODE_SELECTION', START_WORKSHOP_SESSION: 'START_WORKSHOP_SESSION',
  SET_SCENARIO: 'SET_SCENARIO', SUBMIT_DESIGN_PROBLEM: 'SUBMIT_DESIGN_PROBLEM',
  UPDATE_DESIGN_PROBLEM: 'UPDATE_DESIGN_PROBLEM', SELECT_DESIGN_PROBLEM: 'SELECT_DESIGN_PROBLEM',
  SELECT_FIRST_PLAYER: 'SELECT_FIRST_PLAYER', CONFIRM_FIRST_PLAYER: 'CONFIRM_FIRST_PLAYER',
  RESET_FIRST_PLAYER: 'RESET_FIRST_PLAYER', RESET_DESIGN_PROBLEM: 'RESET_DESIGN_PROBLEM',
  RESET_SCENARIO: 'RESET_SCENARIO',
  CANCEL_WORKSHOP_SESSION: 'CANCEL_WORKSHOP_SESSION', RETURN_TO_LOBBY: 'RETURN_TO_LOBBY',
  REPLAY_WORKSHOP_SESSION: 'REPLAY_WORKSHOP_SESSION', APPEND_ARTIFACT: 'APPEND_ARTIFACT',
  UPDATE_ARTIFACT: 'UPDATE_ARTIFACT', REMOVE_ARTIFACT: 'REMOVE_ARTIFACT',
  SUBMIT_PARTNER_SCORE: 'SUBMIT_PARTNER_SCORE', POST_PARTNER_MESSAGE: 'POST_PARTNER_MESSAGE',
  START_PARTNER_STATEMENT: 'START_PARTNER_STATEMENT', ADVANCE_PARTNER_TURN: 'ADVANCE_PARTNER_TURN',
  SET_PARTNER_SPECIAL_PREVIEW: 'SET_PARTNER_SPECIAL_PREVIEW',
  USE_PARTNER_SPECIAL: 'USE_PARTNER_SPECIAL', END_PARTNER_SILENT: 'END_PARTNER_SILENT',
  SUBMIT_PARTNER_CLOSING_VOTE: 'SUBMIT_PARTNER_CLOSING_VOTE',
  ADVANCE_PARTNER_CLOSING: 'ADVANCE_PARTNER_CLOSING', COMPLETE_PARTNER_SESSION: 'COMPLETE_PARTNER_SESSION',
  END_HALLI_ACTIVITY: 'END_HALLI_ACTIVITY', REOPEN_HALLI_IDEA: 'REOPEN_HALLI_IDEA',
  SUBMIT_HALLI_IDEA: 'SUBMIT_HALLI_IDEA',
  COMPLETE_HALLI_SESSION: 'COMPLETE_HALLI_SESSION', START_SPY_GAME: 'START_SPY_GAME',
  ADVANCE_SPY_SPEAKER: 'ADVANCE_SPY_SPEAKER', OPEN_SPY_VOTE: 'OPEN_SPY_VOTE',
  SUBMIT_SPY_VOTE: 'SUBMIT_SPY_VOTE', START_NEXT_SPY_ROUND: 'START_NEXT_SPY_ROUND',
  RESTART_SPY_GAME: 'RESTART_SPY_GAME', COMPLETE_SPY_SESSION: 'COMPLETE_SPY_SESSION'
});

const SIGNAL_TYPES = Object.freeze({
  PARTNER_SILENT_SOUND: 'PARTNER_SILENT_SOUND',
  DESIGN_PROBLEM_NUDGE: 'DESIGN_PROBLEM_NUDGE',
  DESIGN_PROBLEM_EDITING: 'DESIGN_PROBLEM_EDITING'
});
const SIGNAL_TTL_MS = Object.freeze({
  [SIGNAL_TYPES.PARTNER_SILENT_SOUND]: 3000,
  [SIGNAL_TYPES.DESIGN_PROBLEM_NUDGE]: 8000,
  [SIGNAL_TYPES.DESIGN_PROBLEM_EDITING]: 60000
});
const DESIGN_PROBLEM_NUDGE_COOLDOWN_MS = 15000;

const EVENT_TYPES = Object.freeze([
  'ROOM_CREATED', 'ROOM_PROFILE_UPDATED', 'ROOM_DISSOLVED', 'ROOM_RETURNED_TO_LOBBY',
  'MEMBER_JOINED', 'MEMBER_PROFILE_UPDATED', 'SEATS_REORDERED', 'MEMBER_LEFT', 'MEMBER_KICKED',
  'MODE_SELECTION_STARTED', 'MODE_SELECTION_CANCELLED',
  'WORKSHOP_SESSION_STARTED', 'WORKSHOP_SESSION_CANCELLED', 'WORKSHOP_SESSION_REPLAYED',
  'WORKSHOP_SESSION_COMPLETED', 'SCENARIO_SET', 'DESIGN_PROBLEM_SUBMITTED', 'DESIGN_PROBLEM_UPDATED',
  'DESIGN_PROBLEM_SELECTED', 'DESIGN_PROBLEM_SELECTION_RESET', 'PROBLEM_COLLECTION_COMPLETED',
  'SCENARIO_SELECTION_RESET',
  'FIRST_PLAYER_SELECTED', 'FIRST_PLAYER_SELECTION_RESET',
  'PARTNER_TURN_STARTED', 'PARTNER_TURN_COMPLETED', 'PARTNER_TURN_ABANDONED',
  'PARTNER_SCORE_RECORDED', 'PARTNER_STATEMENT_STARTED', 'PARTNER_SPECIAL_PREVIEW_CHANGED', 'PARTNER_SPECIAL_USED',
  'PARTNER_SILENT_ENDED', 'PARTNER_CLOSING_VOTE_STARTED', 'PARTNER_CLOSING_VOTE_RECORDED',
  'PARTNER_CLOSING_QUESTIONED', 'PARTNER_CLOSING_ACCEPTED', 'PARTNER_CLOSING_REVIEW_STARTED',
  'ARTIFACT_APPENDED', 'ARTIFACT_UPDATED', 'ARTIFACT_REMOVED', 'PARTNER_MESSAGE_POSTED',
  'HALLI_CREATIVE_STARTED', 'HALLI_IDEA_REOPENED', 'HALLI_IDEA_SUBMITTED', 'HALLI_SUMMARY_READY',
  'SPY_ROLES_ASSIGNED',
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
  SET_SCENARIO: ['sessionId', 'workflowStep', 'workflowRevision'],
  SUBMIT_DESIGN_PROBLEM: ['sessionId', 'workflowRevision'],
  UPDATE_DESIGN_PROBLEM: ['sessionId', 'workflowStep', 'workflowRevision', 'entityVersion'],
  SELECT_DESIGN_PROBLEM: ['sessionId', 'workflowStep', 'workflowRevision'],
  SELECT_FIRST_PLAYER: ['sessionId', 'workflowStep', 'workflowRevision'],
  CONFIRM_FIRST_PLAYER: ['sessionId', 'workflowRevision'],
  RESET_FIRST_PLAYER: ['sessionId', 'workflowRevision'],
  RESET_DESIGN_PROBLEM: ['sessionId', 'workflowRevision'],
  RESET_SCENARIO: ['sessionId', 'workflowRevision'],
  CANCEL_WORKSHOP_SESSION: ['sessionId'], RETURN_TO_LOBBY: ['sessionId'], REPLAY_WORKSHOP_SESSION: ['sessionId'],
  APPEND_ARTIFACT: ['sessionId', 'turnId', 'workflowStep'],
  UPDATE_ARTIFACT: ['sessionId', 'turnId', 'workflowStep', 'entityVersion'],
  REMOVE_ARTIFACT: ['sessionId', 'turnId', 'workflowStep', 'entityVersion'],
  SUBMIT_PARTNER_SCORE: ['sessionId', 'turnId'],
  POST_PARTNER_MESSAGE: ['sessionId', 'turnId', 'workflowStep'], START_PARTNER_STATEMENT: ['sessionId', 'turnId'],
  ADVANCE_PARTNER_TURN: ['sessionId', 'turnId'], SET_PARTNER_SPECIAL_PREVIEW: ['sessionId', 'turnId'],
  USE_PARTNER_SPECIAL: ['sessionId', 'turnId'],
  END_PARTNER_SILENT: ['sessionId', 'turnId'],
  SUBMIT_PARTNER_CLOSING_VOTE: ['sessionId', 'closingVoteSessionId'], ADVANCE_PARTNER_CLOSING: ['sessionId'],
  COMPLETE_PARTNER_SESSION: ['sessionId'], END_HALLI_ACTIVITY: ['sessionId'],
  REOPEN_HALLI_IDEA: ['sessionId'], SUBMIT_HALLI_IDEA: ['sessionId'],
  COMPLETE_HALLI_SESSION: ['sessionId'], START_SPY_GAME: ['sessionId'],
  ADVANCE_SPY_SPEAKER: ['sessionId', 'gameId', 'speakerTurnId'],
  OPEN_SPY_VOTE: ['sessionId', 'gameId', 'speakerTurnId'],
  SUBMIT_SPY_VOTE: ['sessionId', 'gameId', 'voteSessionId'],
  START_NEXT_SPY_ROUND: ['sessionId', 'gameId', 'roundNo'],
  RESTART_SPY_GAME: ['sessionId', 'gameId'], COMPLETE_SPY_SESSION: ['sessionId', 'gameId']
});

/**
 * 指令 payload 使用白名单，避免旧协议字段或客户端派生状态被服务端静默接收。
 * 这里描述的是传输结构；角色、步骤与实体归属仍由领域 Reducer 裁决。
 */
const COMMAND_PAYLOAD_KEYS = Object.freeze({
  CREATE_ROOM: ['workshopName', 'nickName', 'avatarRef', 'avatarIndex', 'color'],
  JOIN_ROOM: ['nickName', 'avatarRef', 'avatarIndex', 'color'],
  UPDATE_ROOM_PROFILE: ['workshopName'],
  UPDATE_MEMBER_PROFILE: ['nickName', 'avatarRef', 'avatarIndex', 'color'],
  REORDER_SEATS: ['orderedMemberIds'],
  LEAVE_ROOM: [],
  KICK_MEMBER: ['memberId'],
  DISSOLVE_ROOM: [],
  BEGIN_MODE_SELECTION: [],
  CANCEL_MODE_SELECTION: [],
  START_WORKSHOP_SESSION: ['mode'],
  SET_SCENARIO: ['source', 'scenario'],
  SUBMIT_DESIGN_PROBLEM: ['text'],
  UPDATE_DESIGN_PROBLEM: ['contributionId', 'text'],
  SELECT_DESIGN_PROBLEM: ['contributionId'],
  SELECT_FIRST_PLAYER: ['memberId'],
  CONFIRM_FIRST_PLAYER: ['memberId'],
  RESET_FIRST_PLAYER: [],
  RESET_DESIGN_PROBLEM: [],
  RESET_SCENARIO: [],
  CANCEL_WORKSHOP_SESSION: [],
  RETURN_TO_LOBBY: [],
  REPLAY_WORKSHOP_SESSION: [],
  APPEND_ARTIFACT: ['operationId', 'kind', 'text', 'fileRef'],
  UPDATE_ARTIFACT: ['operationId', 'text', 'fileRef'],
  REMOVE_ARTIFACT: ['operationId'],
  SUBMIT_PARTNER_SCORE: ['scoreHalfSteps'],
  POST_PARTNER_MESSAGE: ['text'],
  START_PARTNER_STATEMENT: ['statementResult'],
  ADVANCE_PARTNER_TURN: ['statementResult'],
  SET_PARTNER_SPECIAL_PREVIEW: ['kind', 'active'],
  USE_PARTNER_SPECIAL: ['kind'],
  END_PARTNER_SILENT: [],
  SUBMIT_PARTNER_CLOSING_VOTE: ['vote'],
  ADVANCE_PARTNER_CLOSING: [],
  COMPLETE_PARTNER_SESSION: [],
  END_HALLI_ACTIVITY: [],
  REOPEN_HALLI_IDEA: [],
  SUBMIT_HALLI_IDEA: ['text'],
  COMPLETE_HALLI_SESSION: [],
  START_SPY_GAME: [],
  ADVANCE_SPY_SPEAKER: [],
  OPEN_SPY_VOTE: [],
  SUBMIT_SPY_VOTE: ['targetMemberId', 'abstain'],
  START_NEXT_SPY_ROUND: [],
  RESTART_SPY_GAME: [],
  COMPLETE_SPY_SESSION: []
});

function fail(errCode, errMsg, extra) {
  return { ok: false, errCode, errMsg: errMsg || ERR_MSG[errCode] || errCode,
    retryable: errCode === ERR.DEPENDENCY_UNAVAILABLE || errCode === ERR.RATE_LIMITED, ...(extra || {}) };
}
function okResult(fields) { return { ok: true, ...(fields || {}) }; }
function isNonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function normalizeMode(value) {
  return ({ partner: MODE.PARTNER, PARTNER: MODE.PARTNER, halliGalli: MODE.HALLI_GALLI,
    HALLI_GALLI: MODE.HALLI_GALLI, ganDengYan: MODE.GAN_DENG_YAN,
    GAN_DENG_YAN: MODE.GAN_DENG_YAN, spy: MODE.SPY, SPY: MODE.SPY })[String(value || '').trim()] || null;
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateOptionalText(payload, key, limit, label) {
  if (payload[key] == null) return okResult();
  if (typeof payload[key] !== 'string') return fail(ERR.INVALID_ARGUMENT, `${label}必须是字符串`);
  if (payload[key].length > limit) return fail(ERR.LIMIT_EXCEEDED, `${label}最多 ${limit} 字符`);
  return okResult();
}

function validatePayload(type, payload) {
  let payloadSize = 0;
  try { payloadSize = JSON.stringify(payload).length; } catch (error) {
    return fail(ERR.INVALID_ARGUMENT, 'payload 必须可序列化');
  }
  if (payloadSize > 32 * 1024) return fail(ERR.LIMIT_EXCEEDED, 'payload 超过 32KB');

  const allowedKeys = COMMAND_PAYLOAD_KEYS[type] || [];
  const unknownKey = Object.keys(payload).find((key) => !allowedKeys.includes(key));
  if (unknownKey) return fail(ERR.INVALID_ARGUMENT, `payload.${unknownKey} 不属于 ${type}`);

  if (type === COMMAND_TYPES.START_WORKSHOP_SESSION && !normalizeMode(payload.mode)) {
    return fail(ERR.INVALID_ARGUMENT, 'mode 必须是 PARTNER、GAN_DENG_YAN、HALLI_GALLI 或 SPY');
  }
  if (type === COMMAND_TYPES.SUBMIT_PARTNER_SCORE) {
    const steps = payload.scoreHalfSteps;
    if (!Number.isInteger(steps) || steps < 0 || steps > 10) return fail(ERR.INVALID_ARGUMENT, 'scoreHalfSteps 必须是 0～10 的整数');
  }
  const textLimits = {
    [COMMAND_TYPES.POST_PARTNER_MESSAGE]: ['text', 40, '消息'],
    [COMMAND_TYPES.SUBMIT_DESIGN_PROBLEM]: ['text', 50, '设计问题'],
    [COMMAND_TYPES.UPDATE_DESIGN_PROBLEM]: ['text', 50, '设计问题'],
    [COMMAND_TYPES.SUBMIT_HALLI_IDEA]: ['text', 120, '创意']
  };
  if (textLimits[type]) {
    const [field, limit, label] = textLimits[type];
    if (typeof payload[field] !== 'string') return fail(ERR.INVALID_ARGUMENT, `${label}必须是字符串`);
    const text = payload[field].trim();
    if (!text) return fail(ERR.INVALID_ARGUMENT, `${label}不能为空`);
    if (text.length > limit) return fail(ERR.LIMIT_EXCEEDED, `${label}最多 ${limit} 字`);
  }
  if (type === COMMAND_TYPES.SUBMIT_PARTNER_CLOSING_VOTE && !['pass', 'question'].includes(payload.vote)) {
    return fail(ERR.INVALID_ARGUMENT, 'vote 必须是 pass 或 question');
  }
  if (type === COMMAND_TYPES.USE_PARTNER_SPECIAL && !['HELP_LUCK', 'SILENT', 'MASTER', 'CLOSING'].includes(payload.kind)) {
    return fail(ERR.INVALID_ARGUMENT, '未知特殊行动');
  }
  if (type === COMMAND_TYPES.SET_PARTNER_SPECIAL_PREVIEW) {
    if (payload.kind !== 'HELP_LUCK') return fail(ERR.INVALID_ARGUMENT, '未知特殊行动预览');
    if (typeof payload.active !== 'boolean') return fail(ERR.INVALID_ARGUMENT, 'active 必须是布尔值');
  }
  const requiredString = {
    [COMMAND_TYPES.KICK_MEMBER]: 'memberId',
    [COMMAND_TYPES.UPDATE_DESIGN_PROBLEM]: 'contributionId',
    [COMMAND_TYPES.SELECT_DESIGN_PROBLEM]: 'contributionId',
    [COMMAND_TYPES.SELECT_FIRST_PLAYER]: 'memberId',
    [COMMAND_TYPES.CONFIRM_FIRST_PLAYER]: 'memberId',
    [COMMAND_TYPES.APPEND_ARTIFACT]: 'operationId',
    [COMMAND_TYPES.UPDATE_ARTIFACT]: 'operationId',
    [COMMAND_TYPES.REMOVE_ARTIFACT]: 'operationId'
  }[type];
  if (requiredString && (!isNonEmptyString(payload[requiredString]) || payload[requiredString].length > 128)) {
    return fail(ERR.INVALID_ARGUMENT, `payload.${requiredString} 必须是 1～128 字符`);
  }
  if (type === COMMAND_TYPES.REORDER_SEATS) {
    if (!Array.isArray(payload.orderedMemberIds) || !payload.orderedMemberIds.length
      || payload.orderedMemberIds.length > MAX_SEATS
      || payload.orderedMemberIds.some((id) => !isNonEmptyString(id) || id.length > 128)
      || new Set(payload.orderedMemberIds).size !== payload.orderedMemberIds.length) {
      return fail(ERR.INVALID_ARGUMENT, 'orderedMemberIds 必须是非空成员 ID 数组');
    }
  }
  if (type === COMMAND_TYPES.SET_SCENARIO) {
    const source = String(payload.source || '').toUpperCase();
    if (!['OFFLINE', 'CASE', 'HISTORY', 'CUSTOM'].includes(source)) return fail(ERR.INVALID_ARGUMENT, '未知情境来源');
    if (source === 'OFFLINE' && payload.scenario != null) return fail(ERR.INVALID_ARGUMENT, '线下情境不应携带 scenario');
    const scenario = payload.scenario;
    if (source !== 'OFFLINE' && !isRecord(scenario)) return fail(ERR.INVALID_ARGUMENT, 'scenario 必填');
    const scenarioKeys = scenario ? Object.keys(scenario) : [];
    if (scenarioKeys.some((key) => !['scene', 'user', 'function', 'platform'].includes(key))) {
      return fail(ERR.INVALID_ARGUMENT, 'scenario 包含未知字段');
    }
    if (source !== 'OFFLINE' && (!isNonEmptyString(scenario.scene)
      || !isNonEmptyString(scenario.user) || !isNonEmptyString(scenario.function))) {
      return fail(ERR.INVALID_ARGUMENT, '非线下情境字段不完整');
    }
    if (scenario && ['scene', 'user', 'function', 'platform'].some((key) => scenario[key] != null
      && (typeof scenario[key] !== 'string' || scenario[key].length > 100))) {
      return fail(ERR.LIMIT_EXCEEDED, '情境字段最多 100 字');
    }
  }
  if (type === COMMAND_TYPES.APPEND_ARTIFACT) {
    if (payload.kind != null && !['TEXT', 'IMAGE', 'VOICE'].includes(String(payload.kind))) {
      return fail(ERR.INVALID_ARGUMENT, '未知素材类型');
    }
    if (payload.text != null && typeof payload.text !== 'string') return fail(ERR.INVALID_ARGUMENT, '素材文字必须是字符串');
    if (payload.fileRef != null && typeof payload.fileRef !== 'string') return fail(ERR.INVALID_ARGUMENT, '素材引用必须是字符串');
    const text = payload.text == null ? '' : payload.text.trim();
    const fileRef = payload.fileRef == null ? '' : payload.fileRef.trim();
    if (!text && !fileRef) return fail(ERR.INVALID_ARGUMENT, '素材内容不能为空');
    if (text.length > 500 || fileRef.length > 1024) return fail(ERR.LIMIT_EXCEEDED, '素材内容超过上限');
  }
  if (type === COMMAND_TYPES.UPDATE_ARTIFACT) {
    if (typeof payload.text !== 'string') return fail(ERR.INVALID_ARGUMENT, '素材文字必须是字符串');
    const text = payload.text.trim();
    if (!text) return fail(ERR.INVALID_ARGUMENT, '素材内容不能为空');
    if (text.length > 500) return fail(ERR.LIMIT_EXCEEDED, '共享文本最多 500 字');
    if (payload.fileRef != null && (typeof payload.fileRef !== 'string' || payload.fileRef.length > 1024)) {
      return fail(ERR.LIMIT_EXCEEDED, '素材引用超过上限');
    }
  }
  if (type === COMMAND_TYPES.START_PARTNER_STATEMENT
    && !['allPass', 'partialPass', 'allQuestion'].includes(payload.statementResult)) {
    return fail(ERR.INVALID_ARGUMENT, 'statementResult 不合法');
  }
  if (type === COMMAND_TYPES.ADVANCE_PARTNER_TURN && payload.statementResult != null
    && !['allPass', 'partialPass', 'allQuestion'].includes(payload.statementResult)) {
    return fail(ERR.INVALID_ARGUMENT, 'statementResult 不合法');
  }
  if ([COMMAND_TYPES.CREATE_ROOM, COMMAND_TYPES.JOIN_ROOM, COMMAND_TYPES.UPDATE_MEMBER_PROFILE].includes(type)
    && payload.nickName != null) {
    if (typeof payload.nickName !== 'string') return fail(ERR.INVALID_ARGUMENT, '昵称必须是字符串');
    const name = payload.nickName.trim();
    if (!name || name.length > 20) return fail(ERR.INVALID_ARGUMENT, '昵称必须是 1～20 字');
  }
  if (type === COMMAND_TYPES.UPDATE_ROOM_PROFILE && String(payload.workshopName || '').trim().length > 20) {
    return fail(ERR.LIMIT_EXCEEDED, '房间名称最多 20 字');
  }
  if (type === COMMAND_TYPES.UPDATE_ROOM_PROFILE && !isNonEmptyString(payload.workshopName)) {
    return fail(ERR.INVALID_ARGUMENT, '房间名称不能为空');
  }
  if (type === COMMAND_TYPES.CREATE_ROOM && payload.workshopName != null
    && (!isNonEmptyString(payload.workshopName) || payload.workshopName.trim().length > 20)) {
    return fail(ERR.INVALID_ARGUMENT, '房间名称必须是 1～20 字');
  }
  for (const [key, limit, label] of [
    ['avatarRef', 1024, '头像引用'], ['color', 32, '头像颜色']
  ]) {
    const checked = validateOptionalText(payload, key, limit, label);
    if (!checked.ok) return checked;
  }
  if (payload.color != null && !/^#[0-9a-fA-F]{6}$/.test(payload.color)) {
    return fail(ERR.INVALID_ARGUMENT, '头像颜色必须是 #RRGGBB');
  }
  if (payload.avatarIndex != null
    && (!Number.isInteger(payload.avatarIndex) || payload.avatarIndex < 0 || payload.avatarIndex > 1000)) {
    return fail(ERR.INVALID_ARGUMENT, 'avatarIndex 必须是 0～1000 的整数');
  }
  if (type === COMMAND_TYPES.UPDATE_MEMBER_PROFILE && Object.keys(payload).length === 0) {
    return fail(ERR.INVALID_ARGUMENT, '至少提供一个成员资料字段');
  }
  if (type === COMMAND_TYPES.SUBMIT_SPY_VOTE && payload.abstain !== true && !isNonEmptyString(payload.targetMemberId)) {
    return fail(ERR.INVALID_ARGUMENT, '请选择投票目标或弃票');
  }
  if (type === COMMAND_TYPES.SUBMIT_SPY_VOTE && payload.abstain === true && payload.targetMemberId != null) {
    return fail(ERR.INVALID_ARGUMENT, '弃票时不能同时指定投票目标');
  }
  if (payload.targetMemberId != null
    && (!isNonEmptyString(payload.targetMemberId) || payload.targetMemberId.length > 128)) {
    return fail(ERR.INVALID_ARGUMENT, '投票目标不合法');
  }
  if (type === COMMAND_TYPES.SUBMIT_SPY_VOTE && payload.abstain != null && typeof payload.abstain !== 'boolean') {
    return fail(ERR.INVALID_ARGUMENT, 'abstain 必须是布尔值');
  }
  return okResult();
}

function validateCommandEnvelope(raw) {
  if (!isRecord(raw)) return fail(ERR.INVALID_ARGUMENT, 'command envelope 必填');
  const envelopeKeys = ['protocolVersion', 'commandId', 'roomId', 'knownSeq', 'type', 'context', 'payload', 'clientSentAt'];
  const unknownEnvelope = Object.keys(raw).find((key) => !envelopeKeys.includes(key));
  if (unknownEnvelope) return fail(ERR.INVALID_ARGUMENT, `command.${unknownEnvelope} 是未知字段`);
  if (raw.protocolVersion !== PROTOCOL_VERSION) return fail(ERR.INVALID_ARGUMENT, `仅支持 protocolVersion=${PROTOCOL_VERSION}`);
  const type = String(raw.type || '');
  if (!Object.values(COMMAND_TYPES).includes(type)) return fail(ERR.INVALID_ARGUMENT, `未知命令类型: ${type}`);
  if (!isNonEmptyString(raw.commandId) || raw.commandId.trim().length > 128) return fail(ERR.INVALID_ARGUMENT, 'commandId 必须是 1～128 字符');
  if (type === COMMAND_TYPES.CREATE_ROOM && raw.roomId != null && raw.roomId !== '') {
    return fail(ERR.INVALID_ARGUMENT, 'CREATE_ROOM 不接受客户端 roomId');
  }
  if (type !== COMMAND_TYPES.CREATE_ROOM && (typeof raw.roomId !== 'string' || !/^\d{8}$/.test(raw.roomId.trim()))) {
    return fail(ERR.INVALID_ARGUMENT, 'roomId 必须是 8 位数字');
  }
  const knownSeq = raw.knownSeq == null ? 0 : raw.knownSeq;
  if (!Number.isInteger(knownSeq) || knownSeq < 0) return fail(ERR.INVALID_ARGUMENT, 'knownSeq 必须是非负整数');
  if (raw.clientSentAt != null && (!Number.isFinite(raw.clientSentAt) || raw.clientSentAt < 0)) {
    return fail(ERR.INVALID_ARGUMENT, 'clientSentAt 必须是非负数字');
  }
  if (raw.context != null && !isRecord(raw.context)) return fail(ERR.INVALID_ARGUMENT, 'context 必须是对象');
  if (raw.payload != null && !isRecord(raw.payload)) return fail(ERR.INVALID_ARGUMENT, 'payload 必须是对象');
  const context = raw.context || {};
  const payload = raw.payload || {};
  const contextKeys = COMMAND_CONTEXT[type] || [];
  const unknownContext = Object.keys(context).find((key) => !contextKeys.includes(key));
  if (unknownContext) return fail(ERR.INVALID_ARGUMENT, `context.${unknownContext} 不属于 ${type}`);
  for (const key of contextKeys) {
    if (context[key] == null || context[key] === '') return fail(ERR.INVALID_ARGUMENT, `context.${key} 必填`);
    if (!['entityVersion', 'roundNo', 'workflowRevision'].includes(key)
      && (!isNonEmptyString(context[key]) || context[key].length > 128)) {
      return fail(ERR.INVALID_ARGUMENT, `context.${key} 必须是 1～128 字符`);
    }
  }
  if (context.entityVersion != null
    && (!Number.isInteger(context.entityVersion) || context.entityVersion < 1)) {
    return fail(ERR.INVALID_ARGUMENT, 'context.entityVersion 必须是正整数');
  }
  if (context.roundNo != null
    && (!Number.isInteger(context.roundNo) || context.roundNo < 1)) {
    return fail(ERR.INVALID_ARGUMENT, 'context.roundNo 必须是正整数');
  }
  if (context.workflowRevision != null
    && (!Number.isInteger(context.workflowRevision) || context.workflowRevision < 1)) {
    return fail(ERR.INVALID_ARGUMENT, 'context.workflowRevision 必须是正整数');
  }
  const payloadResult = validatePayload(type, payload);
  if (!payloadResult.ok) return payloadResult;
  return okResult({ envelope: { protocolVersion: PROTOCOL_VERSION, commandId: raw.commandId.trim(),
    roomId: isNonEmptyString(raw.roomId) ? raw.roomId.trim() : '', knownSeq, type, context: { ...context },
    payload: { ...payload }, clientSentAt: Number.isFinite(raw.clientSentAt) ? raw.clientSentAt : null } });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function validPatchPath(path) {
  return typeof path === 'string' && path.length > 0 && path.length <= 512
    && (path === '$' || path.split('.').every((part) => part
      && !['__proto__', 'prototype', 'constructor'].includes(part)));
}

function validatePatch(value) {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !['set', 'remove', 'splice'].includes(key))
    || !Array.isArray(value.remove) || value.remove.length > 512
    || !Array.isArray(value.set) || value.set.length > 512
    || !Array.isArray(value.splice) || value.splice.length > 512) return false;
  return value.set.every((item) => isRecord(item)
      && Object.keys(item).every((key) => key === 'path' || key === 'value')
      && Object.prototype.hasOwnProperty.call(item, 'value')
      && validPatchPath(item.path))
    && value.remove.every(validPatchPath)
    && value.splice.every((item) => isRecord(item)
      && Object.keys(item).every((key) => ['path', 'index', 'deleteCount', 'items'].includes(key))
      && item.path !== '$' && validPatchPath(item.path)
      && Number.isInteger(item.index) && item.index >= 0
      && Number.isInteger(item.deleteCount) && item.deleteCount >= 0
      && Array.isArray(item.items) && item.items.length <= MAX_SESSION_ARTIFACTS);
}

function patchStaysWithin(value, roots) {
  if (!validatePatch(value)) return false;
  const allowed = new Set(roots);
  const validOperation = (path, setValue) => {
    if (path !== '$') return allowed.has(path.split('.')[0]);
    return isRecord(setValue) && Object.keys(setValue).every((key) => allowed.has(key));
  };
  return value.set.every((item) => validOperation(item.path, item.value))
    && value.remove.every((path) => path !== '$' && validOperation(path))
    && value.splice.every((item) => validOperation(item.path));
}

function validatePublicViewPatch(value) {
  return patchStaysWithin(value, ['room', 'session']);
}

function validateActorViewPatch(value) {
  return patchStaysWithin(value, ['actor', 'route', 'navigation']);
}

function validNullableString(value) {
  return value == null || typeof value === 'string';
}

function validProjectedMember(member) {
  return isRecord(member)
    && isNonEmptyString(member.memberId)
    && Number.isInteger(member.seatNo) && member.seatNo >= 1 && member.seatNo <= MAX_SEATS
    && isNonEmptyString(member.nickName)
    && validNullableString(member.avatarRef)
    && (member.avatarIndex == null || (Number.isInteger(member.avatarIndex) && member.avatarIndex >= 0))
    && typeof member.color === 'string'
    && Number.isFinite(member.joinedAt);
}

function validProjectedParticipant(participant) {
  return isRecord(participant)
    && isNonEmptyString(participant.memberId)
    && Number.isInteger(participant.seatNoAtStart)
    && participant.seatNoAtStart >= 1 && participant.seatNoAtStart <= MAX_SEATS
    && ['ACTIVE', 'LEFT'].includes(participant.status)
    && isNonEmptyString(participant.nickName)
    && validNullableString(participant.avatarRef)
    && (participant.avatarIndex == null
      || (Number.isInteger(participant.avatarIndex) && participant.avatarIndex >= 0))
    && typeof participant.color === 'string';
}

function validProjectedDesignProblem(problem) {
  return isRecord(problem)
    && isNonEmptyString(problem.contributionId)
    && isNonEmptyString(problem.memberId)
    && typeof problem.text === 'string'
    && Number.isInteger(problem.entityVersion) && problem.entityVersion >= 1
    && Number.isFinite(problem.createdAt);
}

function validActorStatus(status) {
  return isRecord(status) && typeof status.submitted === 'boolean';
}

function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function validProjectedBack(back) {
  if (!isRecord(back) || !['NONE', 'COMMAND'].includes(back.kind)) return false;
  if (back.kind === 'NONE') return Object.keys(back).length === 1;
  const allowed = [COMMAND_TYPES.CANCEL_MODE_SELECTION, COMMAND_TYPES.CANCEL_WORKSHOP_SESSION, COMMAND_TYPES.RESET_SCENARIO,
    COMMAND_TYPES.RESET_DESIGN_PROBLEM, COMMAND_TYPES.RESET_FIRST_PLAYER];
  if (!allowed.includes(back.commandType) || !isRecord(back.context)) return false;
  const expectedKeys = COMMAND_CONTEXT[back.commandType] || [];
  const actualKeys = Object.keys(back.context);
  if (actualKeys.length !== expectedKeys.length
    || expectedKeys.some((key) => !hasOwn(back.context, key))) return false;
  if (expectedKeys.includes('sessionId') && !isNonEmptyString(back.context.sessionId)) return false;
  if (expectedKeys.includes('workflowRevision')
    && (!Number.isInteger(back.context.workflowRevision) || back.context.workflowRevision < 1)) return false;
  const expectedAfter = back.commandType === COMMAND_TYPES.CANCEL_WORKSHOP_SESSION
    ? 'OPEN_MODE_PICKER'
    : 'FOLLOW_ROUTE';
  return back.after === expectedAfter;
}

/**
 * MemberView 的协议边界校验。模式内部字段由 viewSchemaVersion 演进；这里验证所有页面依赖的稳定骨架。
 */
function validateMemberView(view, expectedRoomId) {
  if (!isRecord(view) || !isRecord(view.room) || !isRecord(view.actor)
    || !isRecord(view.route) || !isRecord(view.navigation) || !isRecord(view.navigation.back)) return false;
  if (!hasOwn(view, 'session')) return false;
  if (typeof view.room.roomId !== 'string' || !/^\d{8}$/.test(view.room.roomId)
    || (expectedRoomId && view.room.roomId !== expectedRoomId)) return false;
  if (!Object.values(LIFECYCLE).includes(view.room.lifecycle)
    || typeof view.room.workshopName !== 'string'
    || !Number.isFinite(view.room.createdAt)
    || !isNonEmptyString(view.room.hostMemberId)
    || !Array.isArray(view.room.members)
    || !view.room.members.every(validProjectedMember)) return false;
  const memberIds = view.room.members.map((member) => member.memberId);
  const seatNos = view.room.members.map((member) => member.seatNo);
  if (new Set(memberIds).size !== memberIds.length || new Set(seatNos).size !== seatNos.length
    || (view.room.lifecycle === LIFECYCLE.OPEN && !memberIds.includes(view.room.hostMemberId))) return false;
  if (!isNonEmptyString(view.actor.memberId)) return false;
  if (!['HOST', 'PLAYER'].includes(view.actor.role)
    || !Number.isInteger(view.actor.seatNo)
    || view.actor.seatNo < 1 || view.actor.seatNo > MAX_SEATS
    || typeof view.actor.isParticipant !== 'boolean'
    || !validActorStatus(view.actor.contributionStatus)
    || !validActorStatus(view.actor.scoreStatus)
    || !validActorStatus(view.actor.voteStatus)
    || !(view.actor.privateModeState == null || isRecord(view.actor.privateModeState))
    || !isRecord(view.actor.capabilities)) return false;
  if (!Object.values(view.actor.capabilities).every((capability) => isRecord(capability)
    && typeof capability.allowed === 'boolean'
    && (capability.reason == null || typeof capability.reason === 'string'))) return false;
  if (!isNonEmptyString(view.route.name) || !isRecord(view.route.params)) return false;
  const back = view.navigation.back;
  if (!validProjectedBack(back)) return false;
  if (view.session == null) return true;
  const session = view.session;
  if (!isRecord(session)
    || !isNonEmptyString(session.sessionId)
    || !Number.isInteger(session.ordinal) || session.ordinal < 1
    || !Object.values(SESSION_STATUS).includes(session.status)
    || !Object.values(MODE).includes(session.mode)
    || !Array.isArray(session.participants)
    || !session.participants.every(validProjectedParticipant)
    || !isRecord(session.setup)
    || !hasOwn(session.setup, 'scenarioSource')
    || !hasOwn(session.setup, 'scenario')
    || !hasOwn(session.setup, 'proposedFirstMemberId')
    || !hasOwn(session.setup, 'selectedProblem')
    || !Array.isArray(session.setup.designProblems)
    || !session.setup.designProblems.every(validProjectedDesignProblem)
    || !(session.setup.selectedProblem == null
      || validProjectedDesignProblem(session.setup.selectedProblem))
    || !isRecord(session.workflow)
    || !Object.values(WORKFLOW_STEP).includes(session.workflow.step)
    || !Number.isInteger(session.workflow.revision) || session.workflow.revision < 1
    || !isRecord(session.progress)
    || !isRecord(session.publicModeState)
    || !hasOwn(session, 'activeTurn')
    || !(session.activeTurn == null || isRecord(session.activeTurn))
    || !Array.isArray(session.activeArtifacts)
    || !Array.isArray(session.recentMessages)
    || !Array.isArray(session.turnSummaries)
    || !hasOwn(session, 'result')
    || !(session.result == null || isRecord(session.result))) return false;
  const participantIds = session.participants.map((participant) => participant.memberId);
  const participantSeats = session.participants.map((participant) => participant.seatNoAtStart);
  return new Set(participantIds).size === participantIds.length
    && new Set(participantSeats).size === participantSeats.length;
}

module.exports = { PROTOCOL_VERSION, SCHEMA_VERSION, VIEW_SCHEMA_VERSION, EVENT_SCHEMA_VERSION,
  MAX_INCREMENTAL_SYNC_EVENTS, MAX_SEATS,
  MAX_SESSION_MESSAGES, MAX_SESSION_ARTIFACTS, MAX_PARTNER_TURNS, MAX_SESSION_DOCUMENT_BYTES,
  MAX_SYNC_RESPONSE_BYTES,
  SPY_VOTE_DURATION_MS,
  LIFECYCLE, SESSION_STATUS, MODE, WORKFLOW_STEP, WORKFLOW_GROUPS, COMMAND_TYPES, EVENT_TYPES,
  SIGNAL_TYPES, SIGNAL_TTL_MS, DESIGN_PROBLEM_NUDGE_COOLDOWN_MS,
  ERR, ERR_MSG, COMMAND_CONTEXT,
  COMMAND_PAYLOAD_KEYS, fail, okResult, isNonEmptyString, normalizeMode, validateCommandEnvelope, stableStringify,
  validatePatch, validatePublicViewPatch, validateActorViewPatch, validateMemberView };
