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
const { staticCdnUrl } = require('../../../../utils/staticCdn');

function halliStepSrc(key) {
  return staticCdnUrl(`assets/halliGalli/step-${key}.webp`);
}

Page(withPageInteractionLock({
  data: {
    roomId: '',
    members: [],
    avatarList: [],
    currentPlayerIndex: 1,
    currentPlayerName: '玩家1',
    isHost: false,
    isGanDengYan: false,
    selectedBG: null,
    stepImgDeal: halliStepSrc('deal'),
    stepImgFlip: halliStepSrc('flip'),
    stepImgRing: halliStepSrc('ring'),
    stepImgPlay: halliStepSrc('play'),
    stepImgVote: halliStepSrc('vote'),
    stepImgJudge: halliStepSrc('judge')
  },

  onLoad(options) {
    const roomId = (options && options.roomId) || '';
    const currentPlayerIndex = options.currentPlayerIndex != null
      ? parseInt(options.currentPlayerIndex, 10) : 1;

    if (!roomId) {
      wx.showToast({ title: '缺少房间参数', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
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
    this.setData({
      members,
      avatarList,
      currentPlayerIndex,
      currentPlayerName: current ? (current.nickName || `玩家${currentPlayerIndex}`) : `玩家${currentPlayerIndex}`,
      isHost: result.isHost === true,
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

  onStepImgError(e) {
    const key = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.key;
    const fields = {
      deal: 'stepImgDeal', flip: 'stepImgFlip', ring: 'stepImgRing',
      play: 'stepImgPlay', vote: 'stepImgVote', judge: 'stepImgJudge'
    };
    const field = fields[key];
    if (!field) return;
    const fallback = `/assets/halliGalli/step-${key}.png`;
    if (this.data[field] !== fallback) this.setData({ [field]: fallback });
  },

  handleGoRoom() {
    return runPageInteraction(this, () => goRoomPage(this.data.roomId), {
      loadingText: '正在返回房间…'
    });
  }
}, ['handleEndGame', 'handleGoRoom', 'onStepImgError']));
