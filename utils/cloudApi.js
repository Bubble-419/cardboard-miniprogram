/**
 * 等待共享云环境就绪后再调用云函数，避免页面首屏时 cloudReady 未完成导致 Failed to fetch
 */
async function waitCloudReady() {
  const app = getApp();
  const ready = app && app.globalData && app.globalData.cloudReady;
  if (!ready || typeof ready.then !== 'function') {
    return;
  }
  try {
    await ready;
  } catch (e) {
    console.warn('waitCloudReady failed', e);
    throw e;
  }
}

async function callCloudFunction(name, data = {}) {
  await waitCloudReady();
  return wx.cloud.callFunction({ name, data });
}

module.exports = {
  waitCloudReady,
  callCloudFunction
};
