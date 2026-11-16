/**
 * 德国心脏病模式 - 游戏页
 * 路径：pages/main-pages/halliGalli/gamepage/
 */
const { goRoomPage } = require('../../../../utils/goRoomPage');
const { prepareMembersForDisplay } = require('../../../../utils/avatars');
const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../../../utils/pageInteractionLock');
const {
  bindPageToRoomSession,
  dispatchRoomCommand,
  followRoomRouteAfterCommand,
  getRoomPageSnapshot,
  unbindPageFromRoomSession
} = require('../../../../modules/room-session/index');
const { clearPendingNavigation } = require('../../../../utils/pageNavigate');
const { staticCdnUrl } = require('../../../../utils/staticCdn');

const STEP_META = [
  { key: 'deal', title: '发牌' },
  { key: 'flip', title: '翻牌' },
  { key: 'ring', title: '抢铃', desc: '准备完成后抢铃争取出牌权' },
  { key: 'play', title: '出牌', desc: '说明如何与情境信息结合' },
  { key: 'vote', title: '表决', desc: '其他玩家投票或提问评分' },
  { key: 'judge', title: '判定', desc: '半数通过即成功，否则失败并摸1张牌' }
];

const VERSION_STEP_DESC = {
  v1: {
    deal: '每位玩家获得3张交互方式卡',
    flip: '展示本轮控件形态卡'
  },
  v2: {
    deal: '每位玩家获得3张控件形态卡',
    flip: '展示本轮交互方式卡'
  }
};

function buildRuleArtVersions() {
  return ['v1', 'v2'].map((id, index) => ({
    id,
    label: `图示 ${index + 1}`,
    steps: STEP_META.map((step, stepIndex) => ({
      key: step.key,
      title: step.title,
      desc: (VERSION_STEP_DESC[id] && VERSION_STEP_DESC[id][step.key]) || step.desc,
      num: stepIndex + 1,
      src: staticCdnUrl(`assets/halliGalli/step-${step.key}-${id}.webp`),
      fallback: `/assets/halliGalli/step-${step.key}.png`
    }))
  }));
}

Page(withPageInteractionLock({
  data: {
    roomId: '',
    members: [],
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    isHost: false,
    canEndGame: false,
    isGanDengYan: false,
    selectedBG: null,
    ruleArtVersions: buildRuleArtVersions(),
    ruleArtIndex: 0
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      require('../../../../modules/room-navigation/physicalNavigation').returnToHome();
      return;
    }

    this.setData({
      roomId,
      currentPlayerIndex
    });

    this.loadRoomData(roomId);
  },

  onUnload() {
    this._stopStatePolling();
  },

  async loadRoomData(roomId) {
    try {
      const result = await getRoomPageSnapshot(roomId, { refresh: true });
      if (!result || result.ok !== true || !result.members || !result.members.length) {
        wx.showToast({ title: result && result.errMsg || '加载失败', icon: 'none' });
        return;
      }
      await this._applySnapshot(result);

      this._startStatePolling();
    } catch (e) {
      console.error('loadRoomData', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async _applySnapshot(result) {
    if (!result || result.ok !== true || !result.members || !result.members.length) return;
    const members = result.members;
    const enriched = await prepareMembersForDisplay(members);
    const avatarList = enriched.map((member) => ({
      id: member.playerIndex,
      avatar: member.avatarImage || member.avatarUrl || '',
      nickName: member.nickName,
      isMe: member.isMe
    }));
    const roomState = result.roomState || {};
    const currentPlayerIndex = roomState.currentPlayerIndex || this.data.currentPlayerIndex || 1;
    const current = members.find((member) => member.playerIndex === currentPlayerIndex);
    const endActivityCapability = result.view && result.view.actor
      && result.view.actor.capabilities && result.view.actor.capabilities.END_HALLI_ACTIVITY;
    const isHost = result.isHost === true;
    this.setData({
      members,
      avatarList,
      currentPlayerIndex,
      currentPlayerName: current ? (current.nickName || `玩家${currentPlayerIndex}`) : `玩家${currentPlayerIndex}`,
      isHost,
      canEndGame: endActivityCapability
        ? endActivityCapability.allowed === true
        : isHost,
      isGanDengYan: (result.selectedModeId || roomState.selectedModeId) === 'ganDengYan',
      selectedBG: result.selectedBG || roomState.selectedBG || null
    });
  },

  _startStatePolling() {
    this._stopStatePolling();
    bindPageToRoomSession(this, {
      getRoomId: () => this.data.roomId || '',
      followNavigation: true,
      onSnapshot: (result) => {
        this._applySnapshot(result).catch((e) => console.warn('halliGalli apply snapshot', e));
      }
    }).catch((e) => console.warn('halliGalli bind room', e));
  },

  _stopStatePolling() {
    unbindPageFromRoomSession(this);
  },

  handleEndGame() {
    const roomId = this.data.roomId || getApp().globalData.roomId || '';
    if (!roomId) {
      wx.showToast({ title: '房间信息丢失', icon: 'none' });
      return;
    }
    return runPageNavigation(this, async () => {
      const result = await dispatchRoomCommand('END_HALLI_ACTIVITY', {});
      if (!result || result.ok !== true) {
        wx.showToast({ title: result && result.errMsg || '结束失败', icon: 'none' });
        return;
      }
      await followRoomRouteAfterCommand(result, roomId);
      return null;
    }, { loadingText: '正在结束游戏…' });
  },

  onRuleArtChange(e) {
    const index = e && e.detail && typeof e.detail.current === 'number'
      ? e.detail.current
      : 0;
    if (index === this.data.ruleArtIndex) return;
    this.setData({ ruleArtIndex: index });
  },

  onStepImgError(e) {
    const dataset = e && e.currentTarget && e.currentTarget.dataset;
    const key = dataset && dataset.key;
    const version = dataset && dataset.version;
    if (!key || !version) return;
    const ruleArtVersions = (this.data.ruleArtVersions || []).map((ver) => {
      if (ver.id !== version) return ver;
      return {
        ...ver,
        steps: (ver.steps || []).map((step) => (
          step.key === key && step.fallback && step.src !== step.fallback
            ? { ...step, src: step.fallback }
            : step
        ))
      };
    });
    this.setData({ ruleArtVersions });
  },

  handleGoRoom() {
    return runPageInteraction(this, () => goRoomPage(this.data.roomId), {
      loadingText: '正在返回房间…'
    });
  },

  /** 点击情境格：只读打开情境卡页（同创意合伙人 confirmBG 叠卡样式） */
  handleViewContext() {
    if (!this.data.selectedBG) {
      wx.showToast({ title: '暂无情境可查看', icon: 'none' });
      return undefined;
    }
    return runPageNavigation(this, async () => {
      const roomId = this.data.roomId || getApp().globalData.roomId || '';
      if (!roomId) {
        wx.showToast({ title: '缺少房间信息', icon: 'none' });
        return null;
      }
      this._pageVisible = false;
      this._stopStatePolling();
      clearPendingNavigation();
      const selectedBG = this.data.selectedBG || null;
      if (selectedBG && getApp().globalData) {
        getApp().globalData.selectedBG = selectedBG;
      }
      return {
        method: 'navigateTo',
        url: `/pages/main-pages/partnerMode/confirmBG/index?roomId=${encodeURIComponent(roomId)}&from=halli`,
        success: (res) => {
          try {
            const ec = res && res.eventChannel;
            if (ec && typeof ec.emit === 'function') {
              ec.emit('initGameDetail', { selectedBG: selectedBG || null });
            }
          } catch (e) {
            console.warn('halli emit initGameDetail', e);
          }
        },
        fail: (err) => {
          console.warn('halliGalli viewContext', err);
          this._pageVisible = true;
          this._startStatePolling();
          wx.showToast({ title: '打开失败', icon: 'none' });
        }
      };
    }, { loadingText: '正在查看情境…' });
  },

  onShow() {
    // 从情境卡返回后恢复房间订阅
    if (this.data.roomId) {
      this._pageVisible = true;
      this._startStatePolling();
    }
  }
}, ['handleEndGame', 'handleGoRoom', 'handleViewContext', 'onStepImgError', 'onRuleArtChange']));
