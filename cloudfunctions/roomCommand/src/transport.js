'use strict';

/**
 * 从 CloudBase 事件中提取严格的 Command Envelope。
 * 新客户端使用 { command }；平铺格式只兼容发布期间的在途客户端，并显式剔除平台注入字段。
 */
function commandEnvelopeFromEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return event || {};
  if (Object.prototype.hasOwnProperty.call(event, 'command')) return event.command;
  const { tcbContext: _platformContext, userInfo: _userInfo, ...legacyEnvelope } = event;
  return legacyEnvelope;
}

module.exports = { commandEnvelopeFromEvent };
