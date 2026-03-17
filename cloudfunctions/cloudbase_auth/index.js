const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 跨账号环境共享鉴权云函数
 * 调用方执行 cloud.init() 时会自动触发此函数
 * 必须返回 errCode: 0 表示授权通过，否则会拒绝访问（-601015/-601017）
 * @see https://developers.weixin.qq.com/minigame/dev/wxcloud/guide/resource-sharing/
 */
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();

  // 跨账号调用时可获取来源方信息
  const fromAppid = wxContext.FROM_APPID;
  const fromOpenid = wxContext.FROM_OPENID;
  const fromUnionid = wxContext.FROM_UNIONID;

  // 可选：根据 fromAppid 做白名单校验，只允许特定小程序访问
  // const ALLOWED_APPIDS = ['wxa37d7e08891c4e4a'];
  // if (fromAppid && !ALLOWED_APPIDS.includes(fromAppid)) {
  //   return { errCode: 1, errMsg: '未授权的小程序' };
  // }

  return {
    errCode: 0,
    errMsg: '',
    auth: JSON.stringify({
      // 自定义安全规则，可在数据库安全规则的 auth.custom 中获取
      fromAppid: fromAppid || '',
      fromOpenid: fromOpenid || '',
    }),
  };
};
