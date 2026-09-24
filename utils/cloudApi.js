/** 等待 App 级云能力初始化完成后再调用云函数。 */
const CLOUD_CALL_TIMEOUT_MS = 12000;

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

function withCloudTimeout(operation, label, timeoutMs = CLOUD_CALL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const error = new Error(`${label || '云服务'}响应超时，请稍后重试`);
      error.code = 'DEPENDENCY_UNAVAILABLE';
      error.errCode = 'DEPENDENCY_UNAVAILABLE';
      error.retryable = true;
      reject(error);
    }, timeoutMs);
    Promise.resolve().then(operation).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function callCloudFunction(name, data = {}, options = {}) {
  await waitCloudReady();
  const requestedTimeoutMs = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
    ? requestedTimeoutMs
    : CLOUD_CALL_TIMEOUT_MS;
  return withCloudTimeout(
    () => wx.cloud.callFunction({ name, data }),
    `云函数 ${name}`,
    timeoutMs
  );
}

module.exports = {
  CLOUD_CALL_TIMEOUT_MS,
  waitCloudReady,
  withCloudTimeout,
  callCloudFunction
};
