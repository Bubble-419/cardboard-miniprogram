// 当前小程序 AppID 与云环境资源方一致，直接初始化自有环境。
const CLOUD_ENV_ID = 'cardboard-miniprogram-6a13aab073';

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

    wx.cloud.init({
      env: CLOUD_ENV_ID,
      traceUser: true,
    });
    this.globalData.cloudReady = Promise.resolve();
    this.globalData.cloud = wx.cloud;
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
