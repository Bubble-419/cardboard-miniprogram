/**
 * 翻牌组件（三态循环，上下翻）
 * 默认：背面 back → 词语 assignedWord → 词语1 word1 → 背面 …
 * skipBack：跳过背面，词语 → 词语1 → 词语 …（牌库浏览用）
 * twoFaceOnly：仅在背面 back ↔ 词语 assignedWord 间翻转，不出现词语1
 *
 * 交互：点击前进一态；上滑前进、下滑后退。手势在组件内 catch，避免误触页面返回。
 */

const SWIPE_THRESHOLD_PX = 36;
/** 小于该位移视为点击，避免微小 touchmove 导致系统不再派发 tap */
const TAP_SLOP_PX = 14;
/** 竖直位移需明显大于水平，才认定为上下翻手势 */
const VERTICAL_AXIS_RATIO = 1.2;

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
    /** 已展示分配词时，再次点击改为请求父级全屏展示，不翻回背面 */
    fullscreenOnAssigned: { type: Boolean, value: false }
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
    _initialState() {
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

    _clearTimers() {
      this._clearFlipTimers();
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
        this._guardTapAfterSwipe();
        if (dy < 0) this._requestFlip('next', 'up');
        else this._requestFlip('prev', 'down');
        return;
      }

      // 点击翻面：不依赖 bindtap（真机上轻微滑动常会取消 tap）
      if (absDx <= TAP_SLOP_PX && absDy <= TAP_SLOP_PX) {
        this._guardTapAfterSwipe();
        this._requestFlip('next', 'up');
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
      if (this.data.fullscreenOnAssigned && this.data.cardState === 'assignedWord') {
        this.triggerEvent('fullscreen', { word: this.data.word || '' });
        return;
      }
      this._requestFlip('next', 'up');
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
