/** 获取当前小程序自有云环境的数据库实例。 */
async function getCloudDatabase() {
  const cloud = wx.cloud || {};
  const db = typeof cloud.database === 'function' ? cloud.database() : null;
  if (!db || typeof db.collection !== 'function') {
    throw new Error('云数据库不可用，请检查云开发初始化');
  }
  return db;
}

module.exports = {
  getCloudDatabase
};
