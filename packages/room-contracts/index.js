'use strict';

const PROTOCOL_VERSION = 2;
const SCHEMA_VERSION = 2;
const MAX_SEATS = 6;

const LIFECYCLE = {
  LOBBY: 'LOBBY',
  ACTIVE: 'ACTIVE',
  DISSOLVED: 'DISSOLVED'
};

const COMMAND_TYPES = {
  CREATE_ROOM: 'CREATE_ROOM',
  JOIN_ROOM: 'JOIN_ROOM',
  LEAVE_ROOM: 'LEAVE_ROOM',
  REORDER_SEATS: 'REORDER_SEATS',
  DISSOLVE_ROOM: 'DISSOLVE_ROOM',
  UPDATE_MEMBER_PROFILE: 'UPDATE_MEMBER_PROFILE'
};

const ERR = {
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  NOT_MEMBER: 'NOT_MEMBER',
  HOST_REQUIRED: 'HOST_REQUIRED',
  HOST_CANNOT_LEAVE: 'HOST_CANNOT_LEAVE',
  SESSION_MISMATCH: 'SESSION_MISMATCH',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  COMMAND_ID_CONFLICT: 'COMMAND_ID_CONFLICT',
  COMMAND_IN_PROGRESS: 'COMMAND_IN_PROGRESS',
  RATE_LIMITED: 'RATE_LIMITED',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  ROOM_DISSOLVED: 'ROOM_DISSOLVED'
};

const ERR_MSG = {
  [ERR.INVALID_ARGUMENT]: '参数不合法',
  [ERR.UNAUTHENTICATED]: '未登录',
  [ERR.ROOM_NOT_FOUND]: '房间不存在',
  [ERR.ROOM_FULL]: '房间已满',
  [ERR.NOT_MEMBER]: '非房间成员',
  [ERR.HOST_REQUIRED]: '仅房主可操作',
  [ERR.HOST_CANNOT_LEAVE]: '房主请使用解散房间',
  [ERR.SESSION_MISMATCH]: '场次已变更',
  [ERR.REVISION_CONFLICT]: '房间状态已更新',
  [ERR.INVALID_TRANSITION]: '当前步骤不允许该操作',
  [ERR.COMMAND_ID_CONFLICT]: 'commandId 冲突',
  [ERR.COMMAND_IN_PROGRESS]: '命令处理中',
  [ERR.RATE_LIMITED]: '请求过于频繁',
  [ERR.DEPENDENCY_UNAVAILABLE]: '依赖暂时不可用',
  [ERR.INTERNAL_ERROR]: '服务异常',
  [ERR.ROOM_DISSOLVED]: '房间已解散'
};

function fail(errCode, errMsg, extra) {
  return {
    ok: false,
    errCode,
    errMsg: errMsg || ERR_MSG[errCode] || errCode,
    retryable: errCode === ERR.DEPENDENCY_UNAVAILABLE || errCode === ERR.COMMAND_IN_PROGRESS,
    ...(extra || {})
  };
}

function okResult(fields) {
  return { ok: true, ...(fields || {}) };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function isCommandId(v) {
  return typeof v === 'string' && v.trim().length >= 4 && v.trim().length <= 64;
}

/**
 * 校验命令信封。CREATE_ROOM 可无 roomId/expectedRevision；JOIN 可无 expectedRevision。
 */
function validateCommandEnvelope(raw) {
  if (!raw || typeof raw !== 'object') {
    return fail(ERR.INVALID_ARGUMENT, 'command envelope 必填');
  }
  const type = raw.type;
  if (!Object.prototype.hasOwnProperty.call(COMMAND_TYPES, type) && !Object.values(COMMAND_TYPES).includes(type)) {
    return fail(ERR.INVALID_ARGUMENT, `未知命令类型: ${type}`);
  }
  if (!isCommandId(raw.commandId)) {
    return fail(ERR.INVALID_ARGUMENT, 'commandId 必填');
  }
  const protocolVersion = raw.protocolVersion == null ? PROTOCOL_VERSION : Number(raw.protocolVersion);
  if (protocolVersion !== PROTOCOL_VERSION) {
    return fail(ERR.INVALID_ARGUMENT, `仅支持 protocolVersion=${PROTOCOL_VERSION}`);
  }

  if (type !== COMMAND_TYPES.CREATE_ROOM && !isNonEmptyString(raw.roomId)) {
    return fail(ERR.INVALID_ARGUMENT, 'roomId 必填');
  }

  const needsRevision =
    type !== COMMAND_TYPES.CREATE_ROOM && type !== COMMAND_TYPES.JOIN_ROOM;
  if (needsRevision) {
    if (raw.expectedRevision == null || !Number.isFinite(Number(raw.expectedRevision))) {
      return fail(ERR.INVALID_ARGUMENT, 'expectedRevision 必填');
    }
  }

  return okResult({
    envelope: {
      protocolVersion: PROTOCOL_VERSION,
      roomId: raw.roomId ? String(raw.roomId).trim() : '',
      sessionId: raw.sessionId || null,
      commandId: String(raw.commandId),
      expectedRevision:
        raw.expectedRevision == null ? null : Number(raw.expectedRevision),
      type,
      payload: raw.payload && typeof raw.payload === 'object' ? raw.payload : {},
      clientSentAt: raw.clientSentAt != null ? Number(raw.clientSentAt) : null
    }
  });
}

function emptyDomainRevisions() {
  return {
    members: 0,
    session: 0,
    scores: 0,
    contributions: 0,
    artifacts: 0,
    messages: 0,
    votes: 0
  };
}

module.exports = {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  MAX_SEATS,
  LIFECYCLE,
  COMMAND_TYPES,
  ERR,
  ERR_MSG,
  fail,
  okResult,
  validateCommandEnvelope,
  emptyDomainRevisions,
  isNonEmptyString
};
