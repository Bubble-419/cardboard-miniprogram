'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AVATAR_IMAGES,
  assignAvatarImages,
  preserveMemberAvatars
} = require('../../utils/avatars');
const { buildRoomJoinPayload } = require('../../utils/wxUserAvatar');

function loadAddPlayerDefinition() {
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  global.getApp = () => ({ globalData: {} });
  const modulePath = '../../pages/main-pages/addPlayer/index';
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return definition;
}

function loadUserListDefinition() {
  let definition = null;
  const originalComponent = global.Component;
  global.Component = (componentDefinition) => {
    definition = componentDefinition;
  };
  const modulePath = '../../components/user-list/index';
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  global.Component = originalComponent;
  return definition;
}

test('不同成员复用同一席位时，随机头像不能继承上一成员的自定义头像', () => {
  const customAvatar = 'https://example.test/member-a-wechat-avatar.png';
  assignAvatarImages([{
    memberId: 'member-a-avatar-regression',
    playerIndex: 901,
    isMe: true,
    avatarUrl: customAvatar,
    avatarIndex: null
  }]);

  const [randomMember] = assignAvatarImages([{
    memberId: 'member-b-avatar-regression',
    playerIndex: 901,
    isMe: true,
    avatarUrl: '',
    avatarIndex: 3
  }]);

  assert.ok(AVATAR_IMAGES.includes(randomMember.avatarImage));
  assert.notEqual(randomMember.avatarImage, customAvatar);
});

test('相邻快照更换席位成员时，保头像逻辑不能把旧成员头像带进随机头像', () => {
  const fallback = AVATAR_IMAGES[4];
  const [member] = preserveMemberAvatars([
    {
      memberId: 'member-new-avatar-regression',
      playerIndex: 902,
      avatarUrl: '',
      avatarImage: fallback
    }
  ], [
    {
      memberId: 'member-old-avatar-regression',
      playerIndex: 902,
      avatarUrl: 'https://example.test/member-old-wechat-avatar.png'
    }
  ]);

  assert.equal(member.avatarImage, fallback);
  assert.ok(AVATAR_IMAGES.includes(member.avatarImage));
});

test('头像展示组件只为同一成员保留上一帧头像，不能只按席位复用', () => {
  const definition = loadUserListDefinition();
  const fallback = AVATAR_IMAGES[5];
  const context = {
    data: { defaultAvatar: AVATAR_IMAGES[0] },
    _isPackagedAvatar: definition.methods._isPackagedAvatar
  };
  const [member] = definition.methods._preserveDisplayAvatars.call(context, [
    {
      id: 3,
      userKey: 'member:new-render-regression',
      avatar: fallback,
      avatarImage: fallback
    }
  ], [
    {
      id: 3,
      userKey: 'member:old-render-regression',
      avatar: 'https://example.test/old-render-avatar.png',
      avatarImage: 'https://example.test/old-render-avatar.png'
    }
  ]);

  assert.equal(member.avatarImage, fallback);
});

test('点击使用随机头像加入时，明确要求加入流程忽略本机已缓存头像', async () => {
  const definition = loadAddPlayerDefinition();
  let joinOptions = null;
  const page = {
    ...definition,
    data: {
      ...definition.data,
      roomId: '12345678',
      pendingJoinRoomId: '12345678',
      showAvatarAuth: true
    },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    async joinRoomThenLoad(roomId, options) {
      assert.equal(roomId, '12345678');
      joinOptions = options;
    }
  };
  global.wx = { clearStorageSync() {} };

  await page._skipAvatarAndJoin();

  assert.deepEqual(joinOptions, { useRandomAvatar: true });
});

test('随机头像加入载荷显式清空旧自定义头像，避免重复加入时沿用服务端资料', () => {
  assert.deepEqual(
    buildRoomJoinPayload(
      { nickName: '不应发送', avatarUrl: 'https://example.test/cached-avatar.png' },
      { useRandomAvatar: true }
    ),
    { avatarRef: null }
  );
});
