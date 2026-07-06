/**
 * 解析当前房间选中的设计问题：优先 globalData，其次云端 room 字段
 */
function resolveSelectedDesignProblem(app, roomResult) {
  const gd = app && app.globalData;
  const fromGlobal = gd && gd.selectedProblem;
  if (fromGlobal && fromGlobal.text) {
    return fromGlobal;
  }

  const fromRoom = roomResult && roomResult.selectedDesignProblem;
  if (fromRoom && fromRoom.text) {
    if (gd) {
      gd.selectedProblem = {
        id: fromRoom.id || '',
        text: fromRoom.text
      };
    }
    return gd ? gd.selectedProblem : fromRoom;
  }

  return null;
}

module.exports = {
  resolveSelectedDesignProblem
};
