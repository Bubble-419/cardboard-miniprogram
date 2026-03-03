Page({
  data: {
    players: [],
    selectedFirstPlayerId: null,
    circleCenterX: 375, // 以 750rpx 设计稿为基准（横向居中）
    circleCenterY: 375, // 将在运行时根据屏幕高度动态更新为屏幕几何中心
    radius: 260,
    slots: [],
    draggingPlayerId: null,
    isDragging: false,
    draggingPosX: null,
    draggingPosY: null,
    pxToRpxScale: 1,
    circleRectPx: null, // circle-wrapper 的 px rect
    ringDiameter: 0, // 圆环直径（rpx），用于 WXML 绑定
    defaultAvatar: '/assets/icons/passenger.png'
  },

  onLoad() {
    this.prepareLayout();
  },

  onReady() {
    this.measureCircleWrapper();
  },

  // 预先计算当前设备下的坐标缩放比例和圆心位置
  prepareLayout() {
    const systemInfo = wx.getSystemInfoSync();
    const windowWidth = systemInfo.windowWidth || 375;
    const windowHeight = systemInfo.windowHeight || 667;
    const scale = 750 / windowWidth;

    this.setData(
      {
        pxToRpxScale: scale,
        circleCenterX: 375,
        circleCenterY: 375
      },
      () => {
        this.initPlayers();
      }
    );
  },

  measureCircleWrapper() {
    const query = wx.createSelectorQuery();
    query.select('#circleWrapper').boundingClientRect();
    query.exec((res) => {
      const rect = res && res[0];
      if (!rect) return;

      const scale =
        this.data.pxToRpxScale || 750 / ((wx.getSystemInfoSync().windowWidth || 375));

      const widthRpx = rect.width * scale;
      const heightRpx = rect.height * scale;

      // 头像尺寸（rpx）——和 .player-avatar 宽高保持一致
      const avatarSize = 136;
      const ringStroke = 4;
      const padding = 12;

      const ringRadius =
        Math.min(widthRpx, heightRpx) / 2 - avatarSize / 2 - ringStroke - padding;

      this.setData(
        {
          circleRectPx: rect,
          circleCenterX: widthRpx / 2,
          circleCenterY: heightRpx / 2,
          radius: ringRadius,
          ringDiameter: ringRadius * 2
        },
        () => {
          if (this.data.players && this.data.players.length) {
            this.setupCircleLayout();
          }
        }
      );
    });
  },

  // 初始化玩家列表（优先从全局获取，没有则使用占位数据）
  initPlayers() {
    const app = getApp();
    let players = [];

    if (app && app.globalData && Array.isArray(app.globalData.players) && app.globalData.players.length > 0) {
      players = app.globalData.players.map((p, index) => ({
        id: p.id != null ? p.id : index + 1,
        label: p.name || `P${index + 1}`,
        avatarUrl: p.avatarUrl || ''
      }));
    } else {
      // 占位示例数据，避免页面空白
      players = Array.from({ length: 6 }).map((_, index) => ({
        id: index + 1,
        label: `P${index + 1}`,
        avatarUrl: ''
      }));
    }

    this.setData(
      {
        players
      },
      () => {
        this.setupCircleLayout();
      }
    );
  },

  // 根据 players 顺序计算环形布局
  setupCircleLayout() {
    const players = this.data.players || [];
    const count = players.length;
    if (!count) return;

    const centerX = this.data.circleCenterX;
    const centerY = this.data.circleCenterY;
    const radius = this.data.radius;
    const startAngle = -Math.PI / 2; // 顶部开始

    const slots = [];
    const positionedPlayers = players.map((p, index) => {
      const angle = startAngle + (index * 2 * Math.PI) / count;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      slots.push({ x, y });

      return {
        ...p,
        x,
        y
      };
    });

    this.setData({
      players: positionedPlayers,
      slots
    });
  },

  // 点击玩家头像：选中首位出牌玩家
  onPlayerTap(e) {
    if (this.data.isDragging) return;

    const id = e.currentTarget.dataset.id;
    this.setData({
      selectedFirstPlayerId: id
    });
  },

  // 长按进入拖拽模式
  onPlayerLongPress(e) {
    const id = e.currentTarget.dataset.id;
    const touch = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    let startX = null;
    let startY = null;
    if (touch) {
      const { x, y } = this.toRpxPosition(touch.pageX, touch.pageY);
      startX = x;
      startY = y;
    }

    this.setData(
      {
        draggingPlayerId: id,
        isDragging: true,
        draggingPosX: startX,
        draggingPosY: startY
      },
      () => {
        // 刚进入拖拽时立即把头像移动到手指位置，并变为拖拽态
        if (startX != null && startY != null) {
          this.updateDraggingLayout(startX, startY);
        }
      }
    );
  },

  // 单个玩家 touchmove：拖拽时头像跟随手指移动
  onPlayerTouchMove(e) {
    if (!this.data.isDragging || !this.data.draggingPlayerId) return;

    const touch = e.touches && e.touches[0];
    if (!touch) return;

    const { x, y } = this.toRpxPosition(touch.pageX, touch.pageY);
    this.updateDraggingLayout(x, y);
  },

  onPlayerTouchEnd(e) {
    if (!this.data.isDragging) return;
    const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    let endX = this.data.draggingPosX;
    let endY = this.data.draggingPosY;
    if (touch) {
      const pos = this.toRpxPosition(touch.pageX, touch.pageY);
      endX = pos.x;
      endY = pos.y;
    }
    this.finishDrag(endX, endY);
  },

  // 圆区域上额外的 touchmove/end 兜底（防止拖动超出头像区域）
  onCircleTouchMove(e) {
    if (!this.data.isDragging || !this.data.draggingPlayerId) return;
    const touch = e.touches && e.touches[0];
    if (!touch) return;
    const { x, y } = this.toRpxPosition(touch.pageX, touch.pageY);
    this.updateDraggingLayout(x, y);
  },

  onCircleTouchEnd(e) {
    if (!this.data.isDragging) return;
    const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
    let endX = this.data.draggingPosX;
    let endY = this.data.draggingPosY;
    if (touch) {
      const pos = this.toRpxPosition(touch.pageX, touch.pageY);
      endX = pos.x;
      endY = pos.y;
    }
    this.finishDrag(endX, endY);
  },

  // 将 pageX/pageY 转换为 circle-wrapper 内部的 rpx 坐标
  toRpxPosition(pageX, pageY) {
    const scale = this.data.pxToRpxScale || 1;
    const rect = this.data.circleRectPx;

    // rect 未就绪时兜底（此时拖拽可能仍不准，但避免报错）
    if (!rect) {
      return { x: pageX * scale, y: pageY * scale };
    }

    const x = (pageX - rect.left) * scale;
    const y = (pageY - rect.top) * scale;
    return { x, y };
  },

  // 拖拽过程中：让被拖拽头像跟随手指移动，其余头像固定在槽位
  updateDraggingLayout(x, y) {
    const { slots, players, draggingPlayerId } = this.data;
    if (!slots || !slots.length || !players || !players.length || !draggingPlayerId) return;

    const reorderResult = this.getReorderResultByPosition(x, y);
    const baseList = reorderResult ? reorderResult.baseList : players;

    const updated = baseList.map((p, index) => {
      const slot = slots[index];
      if (p.id === draggingPlayerId) {
        return {
          ...p,
          x,
          y
        };
      }
      return {
        ...p,
        x: slot.x,
        y: slot.y
      };
    });

    this.setData({
      players: updated,
      draggingPosX: x,
      draggingPosY: y
    });
  },

  // 根据当前位置计算应当插入的槽位顺序（类似手机图标拖动逻辑）
  getReorderResultByPosition(x, y) {
    const { slots, players, draggingPlayerId } = this.data;
    if (!slots || !slots.length || !players || !players.length || !draggingPlayerId) return null;

    let nearestIndex = 0;
    let minDist = Number.MAX_VALUE;

    slots.forEach((slot, index) => {
      const dx = slot.x - x;
      const dy = slot.y - y;
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        nearestIndex = index;
      }
    });

    const currentIndex = players.findIndex((p) => p.id === draggingPlayerId);
    if (currentIndex === -1) {
      return null;
    }

    // 如果最近槽位还是原来的，就不需要调整顺序
    if (nearestIndex === currentIndex) {
      return {
        baseList: players.slice(),
        nearestIndex,
        currentIndex
      };
    }

    const baseList = players.slice();
    const [dragItem] = baseList.splice(currentIndex, 1);
    baseList.splice(nearestIndex, 0, dragItem);

    return {
      baseList,
      nearestIndex,
      currentIndex
    };
  },

  // 松手时：根据结束位置决定是否换位，并吸附回圆环
  finishDrag(endX, endY) {
    const { slots, players, draggingPlayerId } = this.data;
    if (!this.data.isDragging || !draggingPlayerId || !slots || !slots.length || !players || !players.length) {
      this.setData({
        isDragging: false,
        draggingPlayerId: null
      });
      return;
    }

    const x = endX != null ? endX : this.data.draggingPosX;
    const y = endY != null ? endY : this.data.draggingPosY;

    const reorderResult = this.getReorderResultByPosition(x, y);
    const newPlayers = reorderResult ? reorderResult.baseList : players.slice();

    this.setData(
      {
        players: newPlayers,
        isDragging: false,
        draggingPlayerId: null,
        draggingPosX: null,
        draggingPosY: null
      },
      () => {
        // 按最终顺序重新均匀布局到圆环上
        this.setupCircleLayout();
      }
    );
  },

  // 头像加载失败时使用占位图
  onAvatarError(e) {
    const id = e.currentTarget.dataset.id;
    const players = (this.data.players || []).map((p) =>
      p.id === id ? { ...p, avatarUrl: '' } : p
    );
    this.setData({ players });
  },

  // 底部按钮：确认首位玩家并进入出牌玩家选择页
  onConfirmFirstPlayer() {
    if (!this.data.selectedFirstPlayerId) return;

    const playersOrder = (this.data.players || []).map((p) => p.id);

    const app = getApp();
    if (app) {
      app.globalData = app.globalData || {};
      app.globalData.firstPlayerInfo = {
        selectedFirstPlayerId: this.data.selectedFirstPlayerId,
        playersOrder
      };
    }

    wx.showToast({
      title: '已确认首位玩家',
      icon: 'success',
      duration: 800
    });

    // 进入出牌玩家选择页面
    setTimeout(() => {
      wx.navigateTo({
        url: '/pages/main-pages/selectPlayer/index'
      });
    }, 800);
  },

  // 顶部返回按钮：返回 selectPlayer 页面
  goBack() {
    wx.navigateBack();
  }
});

