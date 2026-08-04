const SEGMENT_DURATION_MS = 59000;

function getCloudInstance() {
  const app = getApp();
  if (!app || !app.globalData || !app.globalData.cloud) {
    return null;
  }
  return app.globalData.cloud;
}

async function ensureCloudReady() {
  const app = getApp();
  if (app && app.globalData && app.globalData.cloudReady) {
    await app.globalData.cloudReady;
  }
}

function createPartnerRoundSpeech(hooks = {}) {
  const recorder = wx.getRecorderManager();
  let active = false;
  let recording = false;
  let roomId = '';
  let phase = 'play';
  let segmentTimer = null;
  let uploadChain = Promise.resolve();
  /** 并发 start() 共用同一 in-flight Promise，避免重复弹授权 */
  let startInFlight = null;
  /** 用户明确拒绝后，本页生命周期内不再反复弹窗 */
  let permissionDenied = false;

  const onStopHandler = (res) => {
    recording = false;
    if (!active || !roomId || !res || !res.tempFilePath) {
      if (active) scheduleNextSegment();
      return;
    }
    uploadChain = uploadChain
      .then(() => uploadAndRecognize(roomId, res.tempFilePath, phase))
      .then((text) => {
        if (text && typeof hooks.onText === 'function') {
          hooks.onText(text);
        }
      })
      .catch((err) => {
        console.warn('partnerRoundSpeech segment', err);
      })
      .finally(() => {
        if (active) scheduleNextSegment();
      });
  };

  const onErrorHandler = (err) => {
    recording = false;
    console.warn('partnerRoundSpeech recorder error', err);
    if (active) scheduleNextSegment();
  };

  recorder.onStop(onStopHandler);
  recorder.onError(onErrorHandler);

  function scheduleNextSegment() {
    clearSegmentTimer();
    if (!active) return;
    segmentTimer = setTimeout(() => {
      startSegmentRecording();
    }, 120);
  }

  function clearSegmentTimer() {
    if (segmentTimer) {
      clearTimeout(segmentTimer);
      segmentTimer = null;
    }
  }

  function startSegmentRecording() {
    if (!active || recording) return;
    recording = true;
    recorder.start({
      duration: SEGMENT_DURATION_MS,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    });
  }

  async function uploadAndRecognize(currentRoomId, tempFilePath, currentPhase) {
    await ensureCloudReady();
    const cloud = getCloudInstance();
    if (!cloud) {
      throw new Error('云开发未初始化');
    }

    const cloudPath = `partner-voice/${currentRoomId}/${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`;
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      filePath: tempFilePath
    });
    const fileID = uploadRes && uploadRes.fileID;
    if (!fileID) {
      throw new Error('上传录音失败');
    }

    const callRes = await wx.cloud.callFunction({
      name: 'speechToText',
      data: {
        roomId: currentRoomId,
        fileID,
        phase: currentPhase
      }
    });
    const result = (callRes && callRes.result) || {};
    if (result.ok !== true) {
      throw new Error(result.errMsg || '语音识别失败');
    }
    return result.text || '';
  }

  async function ensureRecordPermission() {
    if (permissionDenied) return false;
    const setting = await wx.getSetting();
    if (setting.authSetting && setting.authSetting['scope.record']) {
      return true;
    }
    try {
      await wx.authorize({ scope: 'scope.record' });
      return true;
    } catch (e) {
      const ok = await new Promise((resolve) => {
        wx.showModal({
          title: '需要麦克风权限',
          content: '用于记录本轮讨论并生成文字纪要',
          confirmText: '去设置',
          success: (res) => {
            if (!res.confirm) {
              resolve(false);
              return;
            }
            wx.openSetting({
              success: (settingRes) => {
                resolve(!!(settingRes.authSetting && settingRes.authSetting['scope.record']));
              },
              fail: () => resolve(false)
            });
          },
          fail: () => resolve(false)
        });
      });
      if (!ok) {
        permissionDenied = true;
      }
      return ok;
    }
  }

  async function doStart(options = {}) {
    if (active) return true;
    const nextRoomId = options.roomId || roomId;
    if (!nextRoomId) return false;

    const permitted = await ensureRecordPermission();
    if (!permitted) return false;

    // 授权等待期间可能被 stop/destroy，或并发已激活
    if (active) return true;

    roomId = nextRoomId;
    phase = options.phase === 'discussion' ? 'discussion' : 'play';
    active = true;
    startSegmentRecording();
    return true;
  }

  return {
    async start(options = {}) {
      if (active) return true;
      if (startInFlight) return startInFlight;
      startInFlight = doStart(options).finally(() => {
        startInFlight = null;
      });
      return startInFlight;
    },

    stop() {
      active = false;
      clearSegmentTimer();
      if (recording) {
        try {
          recorder.stop();
        } catch (e) {
          console.warn('partnerRoundSpeech stop', e);
        }
      }
      recording = false;
    },

    setPhase(nextPhase) {
      phase = nextPhase === 'discussion' ? 'discussion' : 'play';
    },

    destroy() {
      this.stop();
      roomId = '';
      permissionDenied = false;
      startInFlight = null;
    },

    isActive() {
      return active;
    }
  };
}

module.exports = {
  createPartnerRoundSpeech
};
