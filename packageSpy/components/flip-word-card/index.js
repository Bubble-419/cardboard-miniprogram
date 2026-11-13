/**
 * 翻牌组件（三态循环，上下翻）
 * 默认：背面 back → 词语 assignedWord → 词语1 word1 → 背面 …
 * skipBack：跳过背面，词语 → 词语1 → 词语 …（牌库浏览用）
 * twoFaceOnly：仅在背面 back ↔ 词语 assignedWord 间翻转，不出现词语1
 *
 * 交互：单击/上下滑翻页；开启 fullscreenOnAssigned 时双击请求横屏全屏。
 * landscapeGestures：父级 rotate(90deg) 横屏叠层时，左右滑也按视觉上下翻页。
 * enableHorizontalSwipe：竖屏左右滑派发 horizontalswipe，供父级切换词对。
 * 手势在组件内 catch，避免误触页面返回。
 */

const SWIPE_THRESHOLD_PX = 36;
/** 小于该位移视为点击，避免微小 touchmove 导致系统不再派发 tap */
const TAP_SLOP_PX = 14;
/** 竖直位移需明显大于水平，才认定为上下翻手势 */
const VERTICAL_AXIS_RATIO = 1.2;
/** 双击判定窗口；单击翻页会延迟到窗口结束，避免与双击抢手势 */
const DOUBLE_TAP_MS = 280;

Component({
  properties: {
    /** 当前分配词（变了才重置翻牌进度） */
    word: { type: String, value: '' },
    backSrc: { type: String, value: '' },
    assignedWordSrc: { type: String, value: '' },
    assignedWordFallbackSrc: { type: String, value: '' },
    word1Src: { type: String, value: '' },
    word1FallbackSrc: { type: String, value: '' },
    /** 为 true 时不展示背面，直接从词语开始 */
    skipBack: { type: Boolean, value: false },
    /** 为 true 时仅背面 ↔ 词语两态翻转，跳过词语1（第三态） */
    twoFaceOnly: { type: Boolean, value: false },
    /** 为 true 时双击请求父级横屏全屏；单击与滑动仍只翻页 */
    fullscreenOnAssigned: { type: Boolean, value: false },
    /** 挂载时优先进入的卡面：back / assignedWord / word1 */
    initialCardState: { type: String, value: '' },
    /** 为 true 时左右滑也翻页（配合父级横屏旋转叠层） */
    landscapeGestures: { type: Boolean, value: false },
    /** 为 true 时左右滑向父级派发 horizontalswipe（用于切换本局词对） */
    enableHorizontalSwipe: { type: Boolean, value: false },
    /** 图片填充：aspectFit 完整显示；aspectFill 铺满容器左右对齐 */
    imageMode: { type: String, value: 'aspectFit' }
  },

  data: {
    cardState: 'back',
    displaySrc: '',
    flipClass: '',
    animating: false,
    imgError: false,
    showBackFace: true
  },

  observers: {
    word(word) {
      if (word === this._wordKey) return;
      this._wordKey = word || '';
      this._applyState(this._initialState());
    },
    skipBack() {
      if (this.data.animating) return;
      if (this.data.skipBack && this.data.cardState === 'back') {
        this._applyState('assignedWord');
      }
    }
  },

  lifetimes: {
    attached() {
      this._wordKey = this.data.word || '';
      this._applyState(this._initialState());
    },
    detached() {
      this._clearTimers();
    }
  },

  methods: {
    _normalizeState(state) {
      if (state !== 'back' && state !== 'assignedWord' && state !== 'word1') return null;
      if (this.data.skipBack && state === 'back') return 'assignedWord';
      if (this.data.twoFaceOnly && state === 'word1') return 'assignedWord';
      return state;
    },

    _initialState() {
      const preferred = this._normalizeState(this.data.initialCardState);
      if (preferred) return preferred;
      return this.data.skipBack ? 'assignedWord' : 'back';
    },

    _clearFlipTimers() {
      if (this._midTimer) clearTimeout(this._midTimer);
      if (this._endTimer) clearTimeout(this._endTimer);
      if (this._unlockTimer) clearTimeout(this._unlockTimer);
      this._midTimer = null;
      this._endTimer = null;
      this._unlockTimer = null;
    },

    _clearPendingTap() {
      if (this._pendingTapTimer) clearTimeout(this._pendingTapTimer);
      this._pendingTapTimer = null;
      this._lastTapAt = 0;
    },

    _clearTimers() {
      this._clearFlipTimers();
      this._clearPendingTap();
      if (this._tapGuardTimer) clearTimeout(this._tapGuardTimer);
      this._tapGuardTimer = null;
    },

    _srcForState(state) {
      if (state === 'assignedWord') {
        return this.data.assignedWordSrc || this.data.assignedWordFallbackSrc || '';
      }
      if (state === 'word1') {
        return this.data.word1Src || this.data.word1FallbackSrc || '';
      }
      return this.data.backSrc || '';
    },

    _fallbackForState(state) {
      if (state === 'assignedWord') return this.data.assignedWordFallbackSrc || '';
      if (state === 'word1') return this.data.word1FallbackSrc || '';
      return '';
    },

    _applyState(state) {
      this._usedFallback = false;
      this._clearTimers();
      const next = this.data.skipBack && state === 'back' ? 'assignedWord' : state;
      this.setData({
        cardState: next,
        showBackFace: next === 'back',
        displaySrc: this._srcForState(next),
        imgError: false,
        flipClass: '',
        animating: false
      });
    },

    /** 背面 → 词语 → 词语1 → 背面 …；skipBack 时词语 ↔ 词语1；twoFaceOnly 时背面 ↔ 词语 */
    _nextState(cur) {
      if (this.data.twoFaceOnly) {
        return cur === 'back' ? 'assignedWord' : 'back';
      }
      if (cur === 'back') return 'assignedWord';
      if (cur === 'assignedWord') return 'word1';
      if (cur === 'word1') {
        return this.data.skipBack ? 'assignedWord' : 'back';
      }
      return null;
    },

    /** 与前进相反的循环，供下滑切换 */
    _prevState(cur) {
      if (this.data.twoFaceOnly) {
        return cur === 'back' ? 'assignedWord' : 'back';
      }
      if (this.data.skipBack) {
        return cur === 'assignedWord' ? 'word1' : 'assignedWord';
      }
      if (cur === 'back') return 'word1';
      if (cur === 'assignedWord') return 'back';
      if (cur === 'word1') return 'assignedWord';
      return null;
    },

    _guardTapAfterSwipe() {
      this._swiped = true;
      if (this._tapGuardTimer) clearTimeout(this._tapGuardTimer);
      this._tapGuardTimer = setTimeout(() => {
        this._swiped = false;
        this._tapGuardTimer = null;
      }, 320);
    },

    onTouchStart(e) {
      if (this.data.animating) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      this._touch = { x: t.clientX, y: t.clientY };
      this._verticalGesture = false;
      this._swiped = false;
    },

    onTouchMove(e) {
      if (!this._touch || this.data.animating) return;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - this._touch.x;
      const dy = t.clientY - this._touch.y;
      if (
        Math.abs(dy) > 10
        && Math.abs(dy) >= Math.abs(dx) * VERTICAL_AXIS_RATIO
      ) {
        this._verticalGesture = true;
      }
    },

    onTouchEnd(e) {
      const start = this._touch;
      this._touch = null;
      if (!start || this.data.animating) return;

      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (absDy >= SWIPE_THRESHOLD_PX && absDy >= absDx * VERTICAL_AXIS_RATIO) {
        this._clearPendingTap();
        this._guardTapAfterSwipe();
        if (dy < 0) this._requestFlip('next', 'up');
        else this._requestFlip('prev', 'down');
        return;
      }

      // 横屏叠层（父级 rotate 90deg）：屏幕左右对应卡面视觉上下
      // 顺时针 90° 后，卡面视觉上方朝向屏幕右侧（dx > 0）
      if (
        this.data.landscapeGestures
        && absDx >= SWIPE_THRESHOLD_PX
        && absDx >= absDy * VERTICAL_AXIS_RATIO
      ) {
        this._clearPendingTap();
        this._guardTapAfterSwipe();
        if (dx > 0) this._requestFlip('next', 'up');
        else this._requestFlip('prev', 'down');
        return;
      }

      // 竖屏：左右滑交给父级（如结算页切换本局两词），不翻面
      if (
        this.data.enableHorizontalSwipe
        && !this.data.landscapeGestures
        && absDx >= SWIPE_THRESHOLD_PX
        && absDx >= absDy * VERTICAL_AXIS_RATIO
      ) {
        this._clearPendingTap();
        this._guardTapAfterSwipe();
        this.triggerEvent('horizontalswipe', {
          direction: dx < 0 ? 'left' : 'right',
          word: this.data.word || ''
        });
        return;
      }

      // 真机轻微滑动可能取消 tap；两个原生入口必须执行同一个点击意图。
      if (absDx <= TAP_SLOP_PX && absDy <= TAP_SLOP_PX) {
        this._guardTapAfterSwipe();
        this._handleCardTap();
      }
    },

    onTouchCancel() {
      this._touch = null;
      this._verticalGesture = false;
    },

    onTap() {
      // 兜底：部分环境仍会派发 tap；若 touchend 已处理则忽略，避免连翻
      if (this._swiped) {
        this._swiped = false;
        return;
      }
      this._handleCardTap();
    },

    _emitFullscreen() {
      const state = this.data.cardState;
      this.triggerEvent('fullscreen', {
        word: this.data.word || '',
        cardState: state,
        src: this._srcForState(state) || this.data.assignedWordSrc || this.data.assignedWordFallbackSrc || ''
      });
    },

    _handleCardTap() {
      if (this.data.animating) return;

      if (!this.data.fullscreenOnAssigned) {
        this._requestFlip('next', 'up');
        return;
      }

      const now = Date.now();
      if (this._lastTapAt && now - this._lastTapAt <= DOUBLE_TAP_MS) {
        this._clearPendingTap();
        this._emitFullscreen();
        return;
      }

      this._lastTapAt = now;
      if (this._pendingTapTimer) clearTimeout(this._pendingTapTimer);
      this._pendingTapTimer = setTimeout(() => {
        this._pendingTapTimer = null;
        this._lastTapAt = 0;
        if (this.data.animating) return;
        this._requestFlip('next', 'up');
      }, DOUBLE_TAP_MS);
    },

    _requestFlip(direction, axisDir) {
      if (this.data.animating) return false;

      const next = direction === 'prev'
        ? this._prevState(this.data.cardState)
        : this._nextState(this.data.cardState);
      if (!next) return false;
      if (
        next === 'assignedWord'
        && !this.data.assignedWordSrc
        && !this.data.assignedWordFallbackSrc
      ) {
        wx.showToast({ title: '词语加载中', icon: 'none' });
        return false;
      }
      this._flipTo(next, axisDir === 'down' ? 'down' : 'up');
      return true;
    },

    _flipTo(nextState, axisDir) {
      if (this.data.animating) return;

      const dir = axisDir === 'down' ? 'down' : 'up';
      this._clearFlipTimers();
      this.setData({
        animating: true,
        flipClass: `flip-out-${dir}`
      });

      const HALF = 300;

      this._midTimer = setTimeout(() => {
        this._usedFallback = false;
        this.setData({
          cardState: nextState,
          showBackFace: nextState === 'back',
          displaySrc: this._srcForState(nextState),
          imgError: false,
          flipClass: `flip-in-start-${dir}`
        });

        this._endTimer = setTimeout(() => {
          this.setData({ flipClass: 'flip-in' });
          this._unlockTimer = setTimeout(() => {
            this.setData({
              animating: false,
              flipClass: ''
            });
          }, HALF);
        }, 30);
      }, HALF);
    },

    onImgError() {
      if (this.data.cardState === 'back') {
        this.setData({ imgError: true });
        return;
      }
      const fallback = this._fallbackForState(this.data.cardState);
      if (!this._usedFallback && fallback && fallback !== this.data.displaySrc) {
        this._usedFallback = true;
        this.setData({ displaySrc: fallback, imgError: false });
        return;
      }
      this.setData({ imgError: true });
    },

    onImgLoad() {
      this.setData({ imgError: false });
    }
  }
});
