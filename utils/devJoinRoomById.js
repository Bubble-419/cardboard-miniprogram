/**
 * DEV_TEST: 测试用房间号功能（主页输入加入 + 房间页展示）
 * 删除方式：删除本文件，并移除以下 DEV_TEST 标记段落：
 * - pages/main-pages/aaa/index.js / index.wxml / index.wxss
 * - pages/main-pages/addPlayer/index.js / index.wxml / index.wxss
 */
const DEV_ROOM_ID_TEST_ENABLED = true;

function getDevJoinPageData() {
  if (!DEV_ROOM_ID_TEST_ENABLED) {
    return { devJoinEnabled: false };
  }
  return {
    devJoinEnabled: true,
    devJoinRoomIdInput: ''
  };
}

function getDevRoomIdDisplayPatch(roomId) {
  if (!DEV_ROOM_ID_TEST_ENABLED) {
    return { devShowRoomId: false, devRoomIdDisplay: '' };
  }
  return {
    devShowRoomId: true,
    devRoomIdDisplay: roomId || ''
  };
}

module.exports = {
  DEV_ROOM_ID_TEST_ENABLED,
  getDevJoinPageData,
  getDevRoomIdDisplayPatch
};
