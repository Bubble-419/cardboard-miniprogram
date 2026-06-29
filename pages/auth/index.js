/**
 * auth 页已迁移至共用 modeIndex，此页仅作兼容重定向
 */
Page({
  onLoad(options) {
    const params = { modeId: 'halliGalli' };
    if (options) {
      Object.keys(options).forEach((key) => {
        if (options[key] != null && options[key] !== '') {
          params[key] = options[key];
        }
      });
    }
    const query = '?' + Object.keys(params)
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    wx.redirectTo({
      url: `/pages/main-pages/modeIndex/index${query}`,
      fail: () => {
        wx.reLaunch({ url: `/pages/main-pages/modeIndex/index${query}` });
      }
    });
  }
});
