'use strict';

const {
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  MAX_SEATS,
  LIFECYCLE,
  COMMAND_TYPES,
  ERR,
  fail,
  okResult,
  emptyDomainRevisions,
  isNonEmptyString
} = require('@cardboard/room-contracts');

const AVATAR_COLORS = [
  '#5EC159', '#4A90E2', '#E24A4A', '#E2B84A',
  '#9B59B6', '#1ABC9C', '#E67E22', '#3498DB'
];

function allocateSeatNo(seatMap) {
  const used = new Set(
    Object.keys(seatMap || {})
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
  );
  for (let seat = 1; seat <= MAX_SEATS; seat += 1) {
    if (!used.has(seat)) return seat;
  }
  return null;
}

function pickAvatarColor(seatMap, membersByUserId) {
  const used = [];
  Object.values(seatMap || {}).forEach((userId) => {
    const m = membersByUserId[userId];
    if (m && m.avatarColor) used.push(m.avatarColor);
  });
  const available = AVATAR_COLORS.filter((c) => !used.includes(c));
  return available.length ? available[0] : AVATAR_COLORS[0];
}

function buildCapabilities(room, actorUserId) {
  const seatNo = findSeatNo(room.seatMap, actorUserId);
  const isHost = room.hostUserId && String(room.hostUserId) === String(actorUserId);
  const isMember = !!(seatNo || isHost);
  const inLobby = room.lifecycle === LIFECYCLE.LOBBY;
  return {
    joinRoom: {
      allowed: room.lifecycle !== LIFECYCLE.DISSOLVED && memberCount(room.seatMap) < MAX_SEATS,
      reason: room.lifecycle === LIFECYCLE.DISSOLVED ? 'ROOM_DISSOLVED' : (memberCount(room.seatMap) >= MAX_SEATS ? 'ROOM_FULL' : null)
    },
    leaveRoom: {
      allowed: isMember && !isHost,
      reason: !isMember ? 'NOT_MEMBER' : (isHost ? 'HOST_CANNOT_LEAVE' : null)
    },
    reorderSeats: {
      allowed: isHost && inLobby,
      reason: !isHost ? 'HOST_ONLY' : (!inLobby ? 'INVALID_TRANSITION' : null)
    },
    dissolveRoom: {
      allowed: isHost,
      reason: isHost ? null : 'HOST_ONLY'
    },
    submitScore: {
      allowed: false,
      reason: 'NOT_IN_PHASE'
    },
    startStatement: {
      allowed: false,
      reason: 'HOST_ONLY'
    }
  };
}

function buildHead(room, actorUserId) {
  const seatNo = findSeatNo(room.seatMap, actorUserId);
  const isHost = room.hostUserId && String(room.hostUserId) === String(actorUserId);
  return {
    protocolVersion: room.protocolVersion || PROTOCOL_VERSION,
    roomId: room.roomId,
    schemaVersion: room.schemaVersion || SCHEMA_VERSION,
    revision: room.revision,
    lifecycle: room.lifecycle,
    activeSessionId: room.activeSessionId || null,
    workflow: room.workflow || null,
    domainRevisions: room.domainRevisions || emptyDomainRevisions(),
    progress: room.progress || {
      scoredCount: 0,
      requiredScoreCount: 0,
      votedCount: 0,
      requiredVoteCount: 0
    },
    actor: {
      role: isHost ? 'HOST' : (seatNo ? 'PLAYER' : 'NONE'),
      seatNo: seatNo || null
    },
    capabilities: buildCapabilities(room, actorUserId),
    serverTime: Date.now()
  };
}

function projectMembersDomain(room, actorUserId) {
  const list = [];
  const seatMap = room.seatMap || {};
  Object.keys(seatMap)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
    .forEach((seatNo) => {
      const userId = seatMap[String(seatNo)];
      const m = (room.membersByUserId && room.membersByUserId[userId]) || {};
      list.push({
        seatNo,
        nickName: m.nickName || `玩家${seatNo}`,
        avatarColor: m.avatarColor || '#5EC159',
        avatarUrl: m.avatarUrl || null,
        avatarIndex: m.avatarIndex != null ? m.avatarIndex : null,
        role: m.role === 'HOST' || seatNo === 1 ? 'HOST' : 'PLAYER',
        isMe: String(userId) === String(actorUserId),
        online: m.online !== false
        // 不返回 userId / openid
      });
    });
  return list;
}

/**
 * 按域投影快照；仅返回 clientDomainRevisions 落后或缺失的域。
 * @param {object} room
 * @param {object} options
 * @param {string} options.actorUserId
 * @param {string[]} [options.domains]
 * @param {object} [options.clientDomainRevisions]
 * @param {object} [options.extraDomainData] 仓储预加载的域数据 { scores, messages, ... }
 */
function projectSnapshot(room, options) {
  const actorUserId = options && options.actorUserId;
  const requested = (options && options.domains && options.domains.length)
    ? options.domains
    : ['members'];
  const clientRevs = (options && options.clientDomainRevisions) || {};
  const serverRevs = room.domainRevisions || emptyDomainRevisions();
  const extra = (options && options.extraDomainData) || {};

  const domains = {};
  requested.forEach((name) => {
    const serverRev = serverRevs[name] != null ? serverRevs[name] : 0;
    const clientRev = clientRevs[name] != null ? clientRevs[name] : -1;
    if (clientRev >= serverRev && clientRev >= 0) {
      return;
    }
    let data = null;
    if (name === 'members') {
      data = projectMembersDomain(room, actorUserId);
    } else if (Object.prototype.hasOwnProperty.call(extra, name)) {
      data = extra[name];
    } else {
      data = name === 'scores' || name === 'votes' ? {} : [];
    }
    domains[name] = { revision: serverRev, data };
  });

  return {
    roomId: room.roomId,
    revision: room.revision,
    domains,
    serverTime: Date.now()
  };
}

/**
 * 查询侧授权：成员或房主可读；解散房仅房主可读 head。
 */
function authorizeRoomRead(room, actorUserId) {
  if (!isNonEmptyString(actorUserId)) {
    return fail(ERR.UNAUTHENTICATED);
  }
  if (!room) {
    return fail(ERR.ROOM_NOT_FOUND);
  }
  if (room.lifecycle === LIFECYCLE.DISSOLVED || room.status === 'DISSOLVED') {
    return fail(ERR.ROOM_DISSOLVED);
  }
  const seatNo = findSeatNo(room.seatMap, actorUserId);
  const isHost = room.hostUserId && String(room.hostUserId) === String(actorUserId);
  if (!seatNo && !isHost) {
    return fail(ERR.NOT_MEMBER);
  }
  return okResult({ room });
}

function findSeatNo(seatMap, userId) {
  if (!userId || !seatMap) return null;
  const entries = Object.entries(seatMap);
  for (let i = 0; i < entries.length; i += 1) {
    if (String(entries[i][1]) === String(userId)) {
      return parseInt(entries[i][0], 10);
    }
  }
  return null;
}

function memberCount(seatMap) {
  return Object.keys(seatMap || {}).length;
}

function assertActor(actorUserId) {
  if (!isNonEmptyString(actorUserId)) {
    return fail(ERR.UNAUTHENTICATED);
  }
  return null;
}

function createRoomAggregate({ roomId, actorUserId, payload, now }) {
  const nickName = isNonEmptyString(payload.nickName)
    ? String(payload.nickName).trim()
    : '玩家1';
  const avatarUrl = payload.avatarUrl || null;
  const avatarColor = pickAvatarColor({}, {});
  const member = {
    userId: actorUserId,
    seatNo: 1,
    role: 'HOST',
    nickName,
    avatarUrl,
    avatarColor,
    avatarIndex: avatarUrl ? null : 0,
    joinedAt: now
  };
  return {
    roomId,
    schemaVersion: SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    lifecycle: LIFECYCLE.LOBBY,
    // 兼容旧字段
    status: 'CREATED',
    hostUserId: actorUserId,
    creatorId: actorUserId,
    seatMap: { '1': actorUserId },
    activeSessionId: null,
    revision: 1,
    workflow: null,
    domainRevisions: { ...emptyDomainRevisions(), members: 1 },
    progress: {
      scoredCount: 0,
      requiredScoreCount: 0,
      votedCount: 0,
      requiredVoteCount: 0
    },
    workshopName: isNonEmptyString(payload.workshopName)
      ? String(payload.workshopName).trim()
      : '脑暴工作坊',
    membersByUserId: { [actorUserId]: member },
    createdAt: now,
    updatedAt: now
  };
}

/**
 * 纯领域执行：输入当前房间聚合（可为 null）与命令，输出下一状态或错误。
 * 不访问数据库；幂等由 application 层处理。
 */
function executeCommand({ room, envelope, actorUserId, roomIdFactory, now }) {
  const authErr = assertActor(actorUserId);
  if (authErr) return authErr;

  const ts = now || Date.now();
  const { type, payload, expectedRevision, commandId, roomId } = envelope;

  if (type === COMMAND_TYPES.CREATE_ROOM) {
    if (room) {
      return fail(ERR.INVALID_ARGUMENT, '房间已存在');
    }
    const newRoomId = roomIdFactory ? roomIdFactory() : null;
    if (!isNonEmptyString(newRoomId)) {
      return fail(ERR.INTERNAL_ERROR, '无法生成 roomId');
    }
    const next = createRoomAggregate({
      roomId: newRoomId,
      actorUserId,
      payload: payload || {},
      now: ts
    });
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { created: true }
    });
  }

  if (!room) {
    return fail(ERR.ROOM_NOT_FOUND);
  }
  if (room.lifecycle === LIFECYCLE.DISSOLVED || room.status === 'DISSOLVED') {
    return fail(ERR.ROOM_DISSOLVED);
  }

  if (type === COMMAND_TYPES.JOIN_ROOM) {
    const existingSeat = findSeatNo(room.seatMap, actorUserId);
    if (existingSeat) {
      const membersByUserId = { ...room.membersByUserId };
      const prev = membersByUserId[actorUserId] || {};
      const nextMember = { ...prev };
      if (isNonEmptyString(payload.nickName)) {
        nextMember.nickName = String(payload.nickName).trim();
      }
      if (payload.avatarUrl !== undefined) {
        nextMember.avatarUrl = payload.avatarUrl || null;
      }
      membersByUserId[actorUserId] = nextMember;
      const next = {
        ...room,
        membersByUserId,
        updatedAt: ts
      };
      return okResult({
        commandId,
        appliedRevision: room.revision,
        changedDomains: [],
        room: next,
        head: buildHead(next, actorUserId),
        effects: { alreadyMember: true, seatNo: existingSeat }
      });
    }
    if (memberCount(room.seatMap) >= MAX_SEATS) {
      return fail(ERR.ROOM_FULL);
    }
    if (room.lifecycle !== LIFECYCLE.LOBBY && room.lifecycle !== LIFECYCLE.ACTIVE) {
      return fail(ERR.INVALID_TRANSITION);
    }
    const seatNo = allocateSeatNo(room.seatMap);
    if (seatNo == null) return fail(ERR.ROOM_FULL);

    const nickName = isNonEmptyString(payload.nickName)
      ? String(payload.nickName).trim()
      : `玩家${seatNo}`;
    const avatarUrl = payload.avatarUrl || null;
    const avatarColor = pickAvatarColor(room.seatMap, room.membersByUserId || {});
    const member = {
      userId: actorUserId,
      seatNo,
      role: 'PLAYER',
      nickName,
      avatarUrl,
      avatarColor,
      avatarIndex: avatarUrl ? null : Math.min(seatNo - 1, 8),
      joinedAt: ts
    };
    const seatMap = { ...room.seatMap, [String(seatNo)]: actorUserId };
    const membersByUserId = { ...(room.membersByUserId || {}), [actorUserId]: member };
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      seatMap,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { joined: true, seatNo }
    });
  }

  // 以下命令需要成员身份与 expectedRevision
  const actorSeat = findSeatNo(room.seatMap, actorUserId);
  const isHost = String(room.hostUserId) === String(actorUserId);
  if (!actorSeat && !isHost) {
    return fail(ERR.NOT_MEMBER);
  }
  if (expectedRevision == null || Number(expectedRevision) !== Number(room.revision)) {
    return fail(ERR.REVISION_CONFLICT, undefined, {
      latestHead: buildHead(room, actorUserId)
    });
  }

  if (type === COMMAND_TYPES.LEAVE_ROOM) {
    if (isHost) {
      return fail(ERR.HOST_CANNOT_LEAVE);
    }
    const seatMap = { ...room.seatMap };
    delete seatMap[String(actorSeat)];
    const membersByUserId = { ...(room.membersByUserId || {}) };
    delete membersByUserId[actorUserId];
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      seatMap,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { left: true, freedSeatNo: actorSeat }
    });
  }

  if (type === COMMAND_TYPES.DISSOLVE_ROOM) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    const next = {
      ...room,
      lifecycle: LIFECYCLE.DISSOLVED,
      status: 'DISSOLVED',
      seatMap: {},
      membersByUserId: {},
      domainRevisions: {
        ...(room.domainRevisions || emptyDomainRevisions()),
        members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
      },
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { dissolved: true }
    });
  }

  if (type === COMMAND_TYPES.REORDER_SEATS) {
    if (!isHost) return fail(ERR.HOST_REQUIRED);
    if (room.lifecycle !== LIFECYCLE.LOBBY) {
      return fail(ERR.INVALID_TRANSITION, '仅大厅可调整席位');
    }
    const order = Array.isArray(payload.userIdOrder) ? payload.userIdOrder : null;
    if (!order || !order.length) {
      return fail(ERR.INVALID_ARGUMENT, 'userIdOrder 必填');
    }
    const currentIds = Object.values(room.seatMap || {}).map(String).sort();
    const nextIds = order.map(String).sort();
    if (currentIds.length !== nextIds.length || currentIds.join(',') !== nextIds.join(',')) {
      return fail(ERR.INVALID_ARGUMENT, '席位成员集合必须一致');
    }
    if (order.length > MAX_SEATS) {
      return fail(ERR.INVALID_ARGUMENT, '席位超出上限');
    }

    const seatMap = {};
    const membersByUserId = { ...(room.membersByUserId || {}) };
    order.forEach((uid, idx) => {
      const seatNo = idx + 1;
      seatMap[String(seatNo)] = uid;
      if (membersByUserId[uid]) {
        membersByUserId[uid] = {
          ...membersByUserId[uid],
          seatNo,
          role: seatNo === 1 ? 'HOST' : 'PLAYER'
        };
      }
    });
    // 席位 1 视为房主位置；hostUserId 保持创建者不变（产品默认）
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      seatMap,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { reordered: true }
    });
  }

  if (type === COMMAND_TYPES.UPDATE_MEMBER_PROFILE) {
    const membersByUserId = { ...(room.membersByUserId || {}) };
    const prev = membersByUserId[actorUserId];
    if (!prev) return fail(ERR.NOT_MEMBER);
    const nextMember = { ...prev };
    if (isNonEmptyString(payload.nickName)) {
      nextMember.nickName = String(payload.nickName).trim();
    }
    if (payload.avatarUrl !== undefined) {
      nextMember.avatarUrl = payload.avatarUrl || null;
    }
    membersByUserId[actorUserId] = nextMember;
    const domainRevisions = {
      ...(room.domainRevisions || emptyDomainRevisions()),
      members: (room.domainRevisions && room.domainRevisions.members || 0) + 1
    };
    const next = {
      ...room,
      membersByUserId,
      domainRevisions,
      revision: room.revision + 1,
      updatedAt: ts
    };
    return okResult({
      commandId,
      appliedRevision: next.revision,
      changedDomains: ['members'],
      room: next,
      head: buildHead(next, actorUserId),
      effects: { profileUpdated: true }
    });
  }

  return fail(ERR.INVALID_ARGUMENT, `未实现的命令: ${type}`);
}

module.exports = {
  executeCommand,
  buildHead,
  buildCapabilities,
  projectSnapshot,
  projectMembersDomain,
  authorizeRoomRead,
  allocateSeatNo,
  findSeatNo,
  createRoomAggregate
};
