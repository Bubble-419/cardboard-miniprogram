const MIN_CROP = 64;
const HANDLE_HIT = 28;
const MAX_H_OVER_W = 1;
const PRESETS = {
  '1:1': { w: 1, h: 1 },
  '4:3': { w: 4, h: 3 },
  '16:9': { w: 16, h: 9 }
};

function formatRatio(w, h) {
  if (!w || !h) return '1 : 1';
  const g = gcd(Math.round(w), Math.round(h));
  const rw = Math.max(1, Math.round(w / g));
  const rh = Math.max(1, Math.round(h / g));
  if (rw > 30 || rh > 30) {
    return `${(w / h).toFixed(2)} : 1`;
  }
  return `${rw} : ${rh}`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function getStatusBarHeight() {
  try {
    const win = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return Number(win.statusBarHeight) || 20;
  } catch (e) {
    return 20;
  }
}

Page({
  data: {
    src: '',
    statusBarHeight: 20,
    photoStyle: '',
    cropStyle: '',
    maskTopStyle: '',
    maskBottomStyle: '',
    maskLeftStyle: '',
    maskRightStyle: '',
    activePreset: '1:1',
    ratioLabel: '1 : 1',
    exporting: false
  },

  onLoad(query) {
    this._emitted = false;
    this._drag = null;
    this._layout = null;
    this._crop = null;
    this._ec = typeof this.getOpenerEventChannel === 'function'
      ? this.getOpenerEventChannel()
      : null;
    this.setData({ statusBarHeight: getStatusBarHeight() });
    if (this._ec && typeof this._ec.on === 'function') {
      this._ec.on('initCrop', (payload) => {
        const src = payload && payload.src;
        if (src) this._setSrc(src);
      });
    }
    const qSrc = query && query.src ? decodeURIComponent(query.src) : '';
    if (qSrc) this._setSrc(qSrc);
  },

  onUnload() {
    this._emitCancelIfNeeded();
  },

  _setSrc(src) {
    if (!src || this._src === src) return;
    this._src = src;
    this.setData({ src });
    wx.getImageInfo({
      src,
      success: (info) => {
        this._natural = {
          width: Number(info.width) || 0,
          height: Number(info.height) || 0
        };
        this._layoutStage();
      },
      fail: () => {
        wx.showToast({ title: '图片读取失败', icon: 'none' });
        this.onCancel();
      }
    });
  },

  _layoutStage() {
    wx.nextTick(() => {
      wx.createSelectorQuery()
        .select('.crop-stage')
        .boundingClientRect((rect) => {
          if (!rect || !this._natural || !this._natural.width) return;
          const stageW = rect.width;
          const stageH = rect.height;
          const natW = this._natural.width;
          const natH = this._natural.height;
          const scale = Math.min(stageW / natW, stageH / natH);
          const dispW = natW * scale;
          const dispH = natH * scale;
          const imgLeft = (stageW - dispW) / 2;
          const imgTop = (stageH - dispH) / 2;
          this._layout = {
            stageLeft: rect.left,
            stageTop: rect.top,
            stageW,
            stageH,
            imgLeft,
            imgTop,
            dispW,
            dispH,
            scale
          };
          this._applyPreset('1:1');
        })
        .exec();
    });
  },

  _applyPreset(preset) {
    const layout = this._layout;
    if (!layout) return;
    this.data.activePreset = preset;
    if (preset === 'free') {
      if (!this._crop) {
        this._setCrop(this._fitRatioBox(1, 1));
      } else {
        this._setCrop(this._crop);
      }
      return;
    }
    const spec = PRESETS[preset] || PRESETS['1:1'];
    this._setCrop(this._fitRatioBox(spec.w, spec.h));
  },

  _fitRatioBox(rw, rh) {
    const { imgLeft, imgTop, dispW, dispH } = this._layout;
    const target = rw / rh;
    let w;
    let h;
    if (dispW / dispH >= target) {
      h = dispH;
      w = h * target;
    } else {
      w = dispW;
      h = w / target;
    }
    if (h > w) {
      h = w;
    }
    return this._clampCrop({
      x: imgLeft + (dispW - w) / 2,
      y: imgTop + (dispH - h) / 2,
      w,
      h
    });
  },

  _clampCrop(next) {
    const layout = this._layout;
    if (!layout) return next;
    const minX = layout.imgLeft;
    const minY = layout.imgTop;
    const maxW = layout.dispW;
    const maxH = layout.dispH;
    let w = Math.max(MIN_CROP, next.w);
    let h = Math.max(MIN_CROP, next.h);
    if (h > w * MAX_H_OVER_W) h = w * MAX_H_OVER_W;
    if (w > maxW) {
      w = maxW;
      if (h > w) h = w;
    }
    if (h > maxH) {
      h = maxH;
      if (w < h) {
        w = Math.min(maxW, Math.max(h, MIN_CROP));
        h = Math.min(w, maxH);
      }
    }
    let x = next.x;
    let y = next.y;
    x = Math.min(Math.max(minX, x), minX + maxW - w);
    y = Math.min(Math.max(minY, y), minY + maxH - h);
    return { x, y, w, h };
  },

  _setCrop(crop) {
    this._crop = crop;
    const layout = this._layout;
    const right = layout.stageW - crop.x - crop.w;
    const bottom = layout.stageH - crop.y - crop.h;
    this.setData({
      activePreset: this.data.activePreset,
      ratioLabel: formatRatio(crop.w, crop.h),
      photoStyle: [
        `left:${layout.imgLeft}px`,
        `top:${layout.imgTop}px`,
        `width:${layout.dispW}px`,
        `height:${layout.dispH}px`
      ].join(';'),
      cropStyle: [
        `left:${crop.x}px`,
        `top:${crop.y}px`,
        `width:${crop.w}px`,
        `height:${crop.h}px`
      ].join(';'),
      maskTopStyle: `height:${crop.y}px`,
      maskBottomStyle: `top:${crop.y + crop.h}px;height:${Math.max(0, bottom)}px`,
      maskLeftStyle: `top:${crop.y}px;height:${crop.h}px;width:${crop.x}px`,
      maskRightStyle: `top:${crop.y}px;left:${crop.x + crop.w}px;height:${crop.h}px;width:${Math.max(0, right)}px`
    });
  },

  onSelectPreset(e) {
    const preset = e.currentTarget && e.currentTarget.dataset
      ? e.currentTarget.dataset.preset
      : '1:1';
    this.setData({ activePreset: preset });
    this._applyPreset(preset);
  },

  _localPoint(touch) {
    const layout = this._layout;
    if (!layout || !touch) return null;
    return {
      x: touch.clientX - layout.stageLeft,
      y: touch.clientY - layout.stageTop
    };
  },

  _hitHandle(pt, crop) {
    const corners = [
      { id: 'nw', x: crop.x, y: crop.y },
      { id: 'ne', x: crop.x + crop.w, y: crop.y },
      { id: 'sw', x: crop.x, y: crop.y + crop.h },
      { id: 'se', x: crop.x + crop.w, y: crop.y + crop.h }
    ];
    for (let i = 0; i < corners.length; i++) {
      const c = corners[i];
      if (Math.abs(pt.x - c.x) <= HANDLE_HIT && Math.abs(pt.y - c.y) <= HANDLE_HIT) {
        return c.id;
      }
    }
    if (
      pt.x >= crop.x
      && pt.x <= crop.x + crop.w
      && pt.y >= crop.y
      && pt.y <= crop.y + crop.h
    ) {
      return 'move';
    }
    return '';
  },

  onStageTouchStart(e) {
    if (this.data.exporting || !this._crop || !this._layout) return;
    const touch = e.touches && e.touches[0];
    const pt = this._localPoint(touch);
    if (!pt) return;
    const mode = this._hitHandle(pt, this._crop);
    if (!mode) return;
    this._drag = {
      mode,
      startX: pt.x,
      startY: pt.y,
      crop: { ...this._crop }
    };
  },

  onStageTouchMove(e) {
    const drag = this._drag;
    if (!drag) return;
    const touch = e.touches && e.touches[0];
    const pt = this._localPoint(touch);
    if (!pt) return;
    const dx = pt.x - drag.startX;
    const dy = pt.y - drag.startY;
    const start = drag.crop;
    let next = { ...start };
    if (drag.mode === 'move') {
      next.x = start.x + dx;
      next.y = start.y + dy;
    } else {
      this.data.activePreset = 'free';
      if (drag.mode === 'se') {
        next.w = start.w + dx;
        next.h = start.h + dy;
      } else if (drag.mode === 'sw') {
        next.x = start.x + dx;
        next.w = start.w - dx;
        next.h = start.h + dy;
      } else if (drag.mode === 'ne') {
        next.y = start.y + dy;
        next.w = start.w + dx;
        next.h = start.h - dy;
      } else if (drag.mode === 'nw') {
        next.x = start.x + dx;
        next.y = start.y + dy;
        next.w = start.w - dx;
        next.h = start.h - dy;
      }
    }
    this._setCrop(this._clampCrop(next));
  },

  onStageTouchEnd() {
    this._drag = null;
  },

  onCancel() {
    this._emitCancelIfNeeded();
    wx.navigateBack({ fail: () => {} });
  },

  async onConfirm() {
    if (this.data.exporting) return;
    if (!this._crop || !this._layout || !this.data.src) return;
    this.setData({ exporting: true });
    try {
      const tempFilePath = await this._exportCrop();
      if (!tempFilePath) {
        wx.showToast({ title: '裁剪失败', icon: 'none' });
        this.setData({ exporting: false });
        return;
      }
      this._emitted = true;
      if (this._ec && typeof this._ec.emit === 'function') {
        this._ec.emit('cropConfirm', { tempFilePath });
      }
      wx.navigateBack({ fail: () => {} });
    } catch (err) {
      console.warn('imageCrop export', err);
      wx.showToast({ title: '裁剪失败', icon: 'none' });
      this.setData({ exporting: false });
    }
  },

  _emitCancelIfNeeded() {
    if (this._emitted) return;
    this._emitted = true;
    if (this._ec && typeof this._ec.emit === 'function') {
      this._ec.emit('cropCancel');
    }
  },

  _exportCrop() {
    const layout = this._layout;
    const crop = this._crop;
    const src = this.data.src;
    const sx = Math.max(0, (crop.x - layout.imgLeft) / layout.scale);
    const sy = Math.max(0, (crop.y - layout.imgTop) / layout.scale);
    const sw = Math.min(this._natural.width - sx, crop.w / layout.scale);
    const sh = Math.min(this._natural.height - sy, crop.h / layout.scale);
    let outW = Math.max(1, Math.round(sw));
    let outH = Math.max(1, Math.round(sh));
    const maxEdge = 1600;
    if (outW > maxEdge || outH > maxEdge) {
      const s = maxEdge / Math.max(outW, outH);
      outW = Math.max(1, Math.round(outW * s));
      outH = Math.max(1, Math.round(outH * s));
    }
    if (outH > outW) outH = outW;

    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .select('#cropExportCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res && res[0] && res[0].node;
          if (!canvas || typeof canvas.createImage !== 'function') {
            reject(new Error('canvas unavailable'));
            return;
          }
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          const img = canvas.createImage();
          img.onload = () => {
            try {
              ctx.clearRect(0, 0, outW, outH);
              ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
              wx.canvasToTempFilePath({
                canvas,
                fileType: 'jpg',
                quality: 0.92,
                destWidth: outW,
                destHeight: outH,
                success: (fileRes) => resolve(fileRes.tempFilePath),
                fail: reject
              });
            } catch (err) {
              reject(err);
            }
          };
          img.onerror = () => reject(new Error('image load failed'));
          img.src = src;
        });
    });
  }
});
