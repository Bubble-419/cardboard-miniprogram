/**
 * 翻牌组件（三态循环）
 * 默认：背面 back → 词语 assignedWord → 词语1 word1 → 背面 …
 * skipBack：跳过背面，词语 → 词语1 → 词语 …（牌库浏览用）
 */
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
    skipBack: { type: Boolean, value: false }
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

    _clearTimers() {
      if (this._midTimer) clearTimeout(this._midTimer);
      if (this._endTimer) clearTimeout(this._endTimer);
      if (this._unlockTimer) clearTimeout(this._unlockTimer);
      this._midTimer = null;
      this._endTimer = null;
      this._unlockTimer = null;
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

    /** 背面 → 词语 → 词语1 → 背面 …；skipBack 时词语 ↔ 词语1 */
    _nextState(cur) {
      if (cur === 'back') return 'assignedWord';
      if (cur === 'assignedWord') return 'word1';
      if (cur === 'word1') {
        return this.data.skipBack ? 'assignedWord' : 'back';
      }
      return null;
    },

    onTap() {
      if (this.data.animating) return;

      const next = this._nextState(this.data.cardState);
      if (!next) return;
      if (
        next === 'assignedWord'
        && !this.data.assignedWordSrc
        && !this.data.assignedWordFallbackSrc
      ) {
        wx.showToast({ title: '词语加载中', icon: 'none' });
        return;
      }
      this._flipTo(next);
    },

    _flipTo(nextState) {
      if (this.data.animating) return;

      this._clearTimers();
      this.setData({
        animating: true,
        flipClass: 'flip-out'
      });

      const HALF = 300;

      this._midTimer = setTimeout(() => {
        this._usedFallback = false;
        this.setData({
          cardState: nextState,
          showBackFace: nextState === 'back',
          displaySrc: this._srcForState(nextState),
          imgError: false,
          flipClass: 'flip-in-start'
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
