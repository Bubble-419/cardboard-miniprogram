/** 解析当前房间选中的设计问题；V3 View 始终覆盖进程内缓存。 */
function resolveSelectedDesignProblem(app, roomResult) {
  const gd = app && app.globalData;
  const fromRoom = roomResult && roomResult.selectedDesignProblem;
  if (fromRoom && fromRoom.text) {
    const resolved = {
      id: fromRoom.id || fromRoom.contributionId || '',
      text: fromRoom.text
    };
    if (gd) {
      gd.selectedProblem = resolved;
    }
    return resolved;
  }

  // V3 Snapshot 明确没有选中问题时，不允许旧页面缓存补出第二份远端事实。
  if (roomResult && roomResult.protocolVersion === 3) return null;

  const fromGlobal = gd && gd.selectedProblem;
  if (fromGlobal && fromGlobal.text) return fromGlobal;

  return null;
}

module.exports = {
  resolveSelectedDesignProblem
};
