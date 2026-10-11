/**
 * 扫码/主动入房闸门：join 完成前忽略「不在房间」误踢。
 * 微信相机扫码会先唤醒首页/旧会话，若不加闸门会把尚未写入的成员判成 NOT_IN_ROOM。
 */

let _roomId = '';
let _until = 0;
const ROOM_ENTRY_PAGES = new Set(['pages/main-pages/aaa/index', 'pages/main-pages/addPlayer/index']);

function _expired() {
  if (!_roomId) return true;
  if (Date.now() > _until) {
    _roomId = '';
    _until = 0;
    return true;
  }
  return false;
}

function beginScanJoin(roomId, ttlMs) {
  const id = roomId ? String(roomId).trim() : '';
  if (!id) return;
  _roomId = id;
  _until = Date.now() + (ttlMs > 0 ? ttlMs : 20000);
}

function endScanJoin(roomId) {
  if (!_roomId) return;
  if (roomId && String(roomId) !== String(_roomId)) return;
  _roomId = '';
  _until = 0;
}

function isScanJoinActive(roomId) {
  if (_expired()) return false;
  if (roomId && String(roomId) !== String(_roomId)) return false;
  return true;
}

function getScanJoinRoomId() {
  return _expired() ? '' : _roomId;
}

function extractRoomIdFromScene(scene) {
  if (!scene || typeof scene !== 'string') return '';
  let text = scene;
  try {
    text = decodeURIComponent(scene);
  } catch (e) {
    text = scene;
  }
  const rid = text.match(/(?:^|[?&])rid=([^&?#\s]+)/i)
    || text.match(/(?:^|[?&])roomId=([^&?#\s]+)/i);
  if (rid && rid[1] && /^\d{8}$/.test(rid[1].trim())) return rid[1].trim();
  const eight = text.match(/\b(\d{8})\b/);
  return eight ? eight[1] : '';
}

function beginScanJoinFromLaunch(options, context = {}) {
  const path = String((options && options.path) || '').replace(/^\//, '');
  // 普通前台恢复会携带当前业务页的 roomId；只有入房入口才能建立扫码闸门。
  if (path && !ROOM_ENTRY_PAGES.has(path)) return '';
  const query = (options && options.query) || {};
  const scene = query.scene || (options && options.scene) || '';
  const roomId = extractRoomIdFromScene(scene)
    || (query.roomId && /^\d{8}$/.test(String(query.roomId)) ? String(query.roomId) : '')
    || (query.rid && /^\d{8}$/.test(String(query.rid)) ? String(query.rid) : '');
  // 当前房间恢复复用 RoomSession，不能因相同 URL 参数销毁宿主正在订阅的连接。
  if (!roomId || roomId === String(context.currentRoomId || '')) return '';
  beginScanJoin(roomId);
  return roomId;
}

module.exports = {
  beginScanJoin,
  endScanJoin,
  isScanJoinActive,
  getScanJoinRoomId,
  extractRoomIdFromScene,
  beginScanJoinFromLaunch
};
