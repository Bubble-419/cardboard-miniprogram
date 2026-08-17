const { buildAvatarList } = require('../../../utils/avatars');
const { goRoomPage } = require('../../../utils/goRoomPage');

const CASE_BG = {
  scene: '多任务导致学习拖延',
  user: '容易拖延的大学生',
  platform: 'AI学习管理平台',
  function: '汇总拆解并提醒任务'
};

const CASE_PROBLEMS = [
  '如何帮助大学生快速收集分散在不同平台和聊天记录中的学习任务？',
  '如何利用 AI 将模糊、复杂的任务拆解成清晰且容易开始的小步骤？',
  '如何根据截止时间、任务难度和用户状态，合理推荐任务优先级？',
  '如何在不过度打扰用户的情况下，及时提醒其开始或继续任务？',
  '如何通过轻量、有趣的反馈机制，增强用户完成任务的动力？',
  '如何帮助用户回顾任务完成情况，并逐渐改善拖延和时间安排问题？'
];

Page({
  data: {
    roomId: '',
    avatarList: [],
    currentUser: null,
    bg: CASE_BG,
    problems: CASE_PROBLEMS.map((text) => ({ text })),
    scrollHeight: 0
  },

  onLoad(options) {
    this._pageAlive = true;
    let screenHeight = 750;
    try {
      const sys = wx.getSystemInfoSync();
      screenHeight = sys.windowHeight || 750;
    } catch (e) {
      // ignore
    }
    this._windowHeight = screenHeight;

    const roomId = (options && options.roomId) || getApp().globalData.roomId || '';
    if (roomId) getApp().globalData.roomId = roomId;
    this.setData({ roomId });
    if (roomId) {
      this._loadRoomMembers(roomId);
    }

    // 下一次渲染完成后测量 header 高度，计算 scroll-view 可用高度
    this._measureHeaderHeight();
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  handleGoRoom() {
    if (!this.data.roomId) return;
    goRoomPage(this.data.roomId);
  },

  async _loadRoomMembers(roomId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'getAddPlayerData',
        data: { roomId }
      });
      const result = (res && res.result) || {};
      const avatarList = buildAvatarList(result.members || []);
      const me = avatarList.find((item) => item.isMe);
      this.setData({
        avatarList,
        currentUser: me ? me.id : null
      });
    } catch (e) {
      console.warn('case page loadRoomMembers', e);
    }
  },

  _measureHeaderHeight() {
    wx.nextTick(() => {
      if (!this._pageAlive) return;
      const query = wx.createSelectorQuery().in(this);
      query.select('#caseHeader').boundingClientRect();
      query.exec((res) => {
        if (!this._pageAlive) return;
        const rect = res && res[0];
        if (rect && rect.height) {
          const windowHeight = this._windowHeight || 750;
          // 留出底部 footer 遮罩/内边距的余量，避免超出屏幕
          this.setData({ scrollHeight: Math.max(200, windowHeight - rect.height) });
        }
      });
    });
  },

  onShow() {
    this._measureHeaderHeight();
  },

  onUnload() {
    this._pageAlive = false;
  }
});

