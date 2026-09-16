/** 等待 App 级云能力初始化完成后再调用云函数。 */
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
