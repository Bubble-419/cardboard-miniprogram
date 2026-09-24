'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getOptionalProfileForRoom } = require('../../utils/wxUserAvatar');

test('创建房间前头像上传丢失回调时按超时降级，不阻塞创建', async () => {
  global.wx = {
    getStorageSync() {
      return { nickName: '测试用户', avatarUrl: 'wxfile://tmp/avatar.png' };
    },
    cloud: {
      uploadFile() {
        return new Promise(() => {});
      }
    }
  };

  const profile = await getOptionalProfileForRoom({ timeoutMs: 5 });

  assert.equal(profile, null);
});
