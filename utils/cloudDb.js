/**
 * 获取云数据库实例（兼容共享云环境）
 */
async function getCloudDatabase() {
  const cloud = wx.cloud || {};
  let db = null;
  try {
    if (typeof cloud.database === 'function') {
      const maybeDb = cloud.database();
      if (maybeDb && typeof maybeDb.then === 'function') {
        db = await maybeDb;
      } else {
        db = maybeDb;
      }
    } else if (cloud.database && typeof cloud.database.collection === 'function') {
      db = cloud.database;
    }
  } catch (e) {
    db = null;
  }
  if (!db || typeof db.collection !== 'function') {
    throw new Error('云数据库不可用，请检查云开发初始化');
  }
  return db;
}

module.exports = {
  getCloudDatabase
};
