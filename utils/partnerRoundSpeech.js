const SEGMENT_DURATION_MS = 59000;

const { dispatchRoomCommand, getActiveRoomSession } = require('../modules/room-session/index');

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
  let segmentContext = null;
  /** 并发 start() 共用同一 in-flight Promise，避免重复弹授权 */
  let startInFlight = null;
  /** 用户明确拒绝后，本页生命周期内不再反复弹窗 */
  let permissionDenied = false;

  const onStopHandler = (res) => {
    recording = false;
    const stoppedContext = segmentContext;
    segmentContext = null;
    if (!active || !stoppedContext || !res || !res.tempFilePath) {
      if (active) scheduleNextSegment();
      return;
    }
    uploadChain = uploadChain
      .then(() => uploadAndRecognize(stoppedContext, res.tempFilePath))
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
    segmentContext = null;
    console.warn('partnerRoundSpeech recorder error', err);
    if (active) scheduleNextSegment();
  };

  recorder.onStop(onStopHandler);
  recorder.onError(onErrorHandler);

  function scheduleNextSegment(delayMs = 120) {
    clearSegmentTimer();
    if (!active) return;
    segmentTimer = setTimeout(() => {
      startSegmentRecording();
    }, delayMs);
  }

  function clearSegmentTimer() {
    if (segmentTimer) {
      clearTimeout(segmentTimer);
      segmentTimer = null;
    }
  }

  function startSegmentRecording() {
    if (!active || recording) return;
    const roomSession = getActiveRoomSession();
    const view = roomSession && roomSession.getView ? roomSession.getView() : null;
    const session = view && view.session;
    const turn = session && session.activeTurn;
    if (!session || !turn || session.mode !== 'PARTNER') {
      // 页面切换期间暂时没有可录制 Turn，低频等待新快照，避免 120ms 空转。
      scheduleNextSegment(1000);
      return;
    }
    // 录音开始时冻结业务上下文；上传期间换轮时由服务端以旧令牌拒绝，绝不把旧音频写进新 Turn。
    segmentContext = { roomId, sessionId: session.sessionId, turnId: turn.turnId, phase };
    recording = true;
    recorder.start({
      duration: SEGMENT_DURATION_MS,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    });
  }

  async function uploadAndRecognize(context, tempFilePath) {
    await ensureCloudReady();
    const cloud = getCloudInstance();
    if (!cloud) {
      throw new Error('云开发未初始化');
    }

    const cloudPath = `partner-voice/${context.roomId}/${Date.now()}_${Math.floor(Math.random() * 1000)}.mp3`;
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
        roomId: context.roomId,
        sessionId: context.sessionId,
        turnId: context.turnId,
        fileID,
        phase: context.phase
      }
    });
    const result = (callRes && callRes.result) || {};
    if (result.ok !== true) {
      throw new Error(result.errMsg || '语音识别失败');
    }
    const text = String(result.text || '').trim();
    if (!text) return '';
    const operationId = `voice_${context.turnId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const appended = await dispatchRoomCommand('APPEND_ARTIFACT', {
      operationId,
      kind: 'VOICE',
      text,
      fileRef: result.fileRef || fileID
    }, {
      sessionId: context.sessionId,
      turnId: context.turnId,
      workflowStep: context.phase === 'discussion' ? 'PARTNER_STATEMENT' : 'PARTNER_TURN'
    });
    if (!appended || appended.ok !== true) {
      throw new Error(appended && appended.errMsg || '语音纪要入房间失败');
    }
    return text;
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
      segmentContext = null;
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
