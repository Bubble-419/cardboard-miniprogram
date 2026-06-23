/**
 * auth 页已迁移至 halliGalli/modeIndex，此页仅作兼容重定向
 */
Page({
  onLoad(options) {
    const params = [];
    if (options) {
      Object.keys(options).forEach((key) => {
        if (options[key] != null && options[key] !== '') {
          params.push(`${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`);
        }
      });
    }
    const query = params.length ? `?${params.join('&')}` : '';
    wx.redirectTo({
      url: `/pages/main-pages/halliGalli/modeIndex/index${query}`,
      fail: () => {
        wx.reLaunch({ url: `/pages/main-pages/halliGalli/modeIndex/index${query}` });
      }
    });
  }
});
