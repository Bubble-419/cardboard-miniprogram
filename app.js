// ========== 共享云环境配置 ==========
// 若当前小程序是「调用方」（使用其他小程序的云环境），设为 true 并填写 resourceAppid
// 参考：https://developers.weixin.qq.com/minigame/dev/wxcloud/guide/resource-sharing/
const USE_SHARED_ENV = true;
const SHARED_ENV_CONFIG = {
  resourceAppid: 'wx6c484b4cfa055d73',  // 资源方小程序 AppID
  resourceEnv: 'cardboard-miniprogram-6a13aab073',
  traceUser: true,
};

function patchWxCloudForSharedEnv(app) {
  const origCallFunction = wx.cloud.callFunction.bind(wx.cloud);
  const origDatabase = wx.cloud.database.bind(wx.cloud);
  const origGetTempFileURL = wx.cloud.getTempFileURL ? wx.cloud.getTempFileURL.bind(wx.cloud) : null;

  wx.cloud.callFunction = function(opts) {
    const ready = app.globalData.cloudReady;
    if (!ready) {
      return Promise.reject(new Error('cloud not ready'));
    }
    return ready.then(() => {
      const cloud = app.globalData.cloud;
      if (!cloud || typeof cloud.callFunction !== 'function') {
        return Promise.reject(new Error('cloud not initialized'));
      }
      return cloud.callFunction(opts);
    });
  };
  wx.cloud.database = function() {
    return app.globalData.cloudReady.then(() => app.globalData.cloud.database());
  };
  if (origGetTempFileURL) {
    wx.cloud.getTempFileURL = function(opts) {
      return app.globalData.cloudReady.then(() => app.globalData.cloud.getTempFileURL(opts));
    };
  }
  wx.cloud.downloadFile = function(opts) {
    return app.globalData.cloudReady.then(() => {
      const cloud = app.globalData.cloud;
      if (!cloud || typeof cloud.downloadFile !== 'function') {
        return Promise.reject(new Error('cloud downloadFile unavailable'));
      }
      return cloud.downloadFile(opts);
    });
  };
  if (app.globalData.cloud.uploadFile) {
    wx.cloud.uploadFile = function(opts) {
      return app.globalData.cloudReady.then(() => app.globalData.cloud.uploadFile(opts));
    };
  }
}

App({
  onLaunch(options) {
    try {
      const { beginScanJoinFromLaunch } = require('./utils/scanJoinGate');
      beginScanJoinFromLaunch(options);
    } catch (e) {
      // ignore
    }

    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
      return;
    }

    if (USE_SHARED_ENV && SHARED_ENV_CONFIG.resourceAppid) {
      // 使用共享环境：必须用 new wx.cloud.Cloud 并 await init
      const c1 = new wx.cloud.Cloud({
        resourceAppid: SHARED_ENV_CONFIG.resourceAppid,
        resourceEnv: SHARED_ENV_CONFIG.resourceEnv,
        traceUser: SHARED_ENV_CONFIG.traceUser,
      });
      this.globalData.cloud = c1;
      this.globalData.cloudReady = c1.init().catch((err) => {
        console.error('共享云环境初始化失败', err);
        throw err;
      });
      patchWxCloudForSharedEnv(this);
    } else {
      // 使用自有环境
      wx.cloud.init({
        env: SHARED_ENV_CONFIG.resourceEnv,
        traceUser: SHARED_ENV_CONFIG.traceUser,
      });
      this.globalData.cloudReady = Promise.resolve();
      this.globalData.cloud = wx.cloud;
    }
  },

  onShow(options) {
    try {
      const { beginScanJoinFromLaunch, isScanJoinActive } = require('./utils/scanJoinGate');
      beginScanJoinFromLaunch(options);
      if (isScanJoinActive()) {
        const { disposeRoomSession } = require('./modules/room-session/index');
        disposeRoomSession();
        return;
      }
      const { resumeRoomSession } = require('./modules/room-session/index');
      resumeRoomSession();
    } catch (e) {
      // ignore
    }
  },

  onHide() {
    try {
      const { pauseRoomSession } = require('./modules/room-session/index');
      pauseRoomSession();
    } catch (e) {
      // ignore
    }
  },

  globalData: {
    cloudReady: null,
    cloud: null,
    roomSession: null,
    userRole: null,
    roomId: null,
    selectedProblem: null,
    selectedMode: null,
    selectedPlayer: null,
    gameMode: null,
    selectedBG: null,
    workshopName: "工作坊名称"
  }
})

