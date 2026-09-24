const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pageWxml = fs.readFileSync(
  path.resolve(__dirname, '../../pages/main-pages/addPlayer/index.wxml'),
  'utf8'
);

function loadPageDefinition() {
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

test('member waiting state still requests the exit action', () => {
  const definition = loadPageDefinition();
  const page = {
    ...definition,
    data: {
      ...definition.data,
      isHost: false,
      hasSelectedMode: false,
      brainstormSessionEnded: false,
      memberCount: 2
    }
  };

  const footer = page._computeFooterActions();
  assert.equal(footer.showWaitingHint, true);
  assert.equal(footer.showExitText, true);
  assert.equal(footer.exitTextAction, 'leave');
});

test('room member can still exit while waiting for the host', () => {
  assert.match(
    pageWxml,
    /<view class="waiting-hint" wx:if="\{\{showWaitingHint\}\}">/,
    '成员等待房主时应继续显示等待提示'
  );
  assert.match(
    pageWxml,
    /<view class="footer-actions" wx:if="\{\{\(primaryBtnAction && primaryBtnText\) \|\| showExitText\}\}">/,
    '等待提示不应隐藏包含退出房间按钮的底部操作区'
  );
  assert.match(
    pageWxml,
    /wx:if="\{\{showExitText\}\}"[\s\S]*?class="exit-text-btn exit-text-btn-danger"[\s\S]*?catchtap="onTapExitText"/,
    '非房主成员应保留退出房间入口'
  );
  assert.doesNotMatch(
    pageWxml,
    /exit-outline-btn/,
    '成员退出与房主解散应使用相同样式'
  );
});

test('中途加入的旁观成员不能从大厅进入当前场次', () => {
  const definition = loadPageDefinition();
  const page = {
    ...definition,
    data: {
      ...definition.data,
      isHost: false,
      isParticipant: false,
      hasSelectedMode: true,
      brainstormSessionEnded: false,
      memberCount: 4
    }
  };

  const footer = page._computeFooterActions();
  assert.equal(footer.primaryBtnDisabled, true);
  assert.equal(footer.primaryBtnAction, '');
  assert.equal(footer.showWaitingHint, true);
  assert.match(footer.waitingHintText, /下一场/);
});

test('快照未就绪时大厅仍显示离开入口，不展示无效的开始游戏', () => {
  const definition = loadPageDefinition();
  assert.equal(definition.data.showExitText, true);
  assert.equal(definition.data.primaryBtnText, '');
  assert.equal(definition.data.primaryBtnAction, '');
  assert.equal(definition.data.exitTextAction, 'leave');

  const page = {
    ...definition,
    data: {
      ...definition.data,
      isFromScan: false
    }
  };
  const footer = page._degradedLobbyFooter();
  assert.equal(footer.showExitText, true);
  assert.equal(footer.exitTextLabel, '离开房间');
  assert.equal(footer.primaryBtnText, '');
});

test('解散房间不依赖已成功安装的 isHost 快照', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/addPlayer/index.js'),
    'utf8'
  );
  assert.match(source, /HOST_CANNOT_LEAVE/);
  assert.doesNotMatch(
    source,
    /handleDissolveRoom\(\) \{\s*if \(!this\.data\.isHost\) return;/,
    '快照失败时房主仍需能解散'
  );
});

test('静默刷新成功后仍会补拉二维码，快照失败也会尝试 roomMedia', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/addPlayer/index.js'),
    'utf8'
  );
  assert.match(source, /this\._fillQrcodeIfNeeded\(roomId\)/);
  assert.match(source, /async _fetchRoomQrcode\(roomId, force = false\)/);
  assert.match(source, /callCloudFunction\('roomMedia'/);
  const silentBlock = source.split('if (silent) {')[1] || '';
  assert.match(silentBlock.slice(0, 1800), /_fillQrcodeIfNeeded\(roomId\)/);
});

test('退出房间复用统一清理与有超时导航，不等待裸 reLaunch 回调', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/addPlayer/index.js'),
    'utf8'
  );
  const leaveBlock = source.split('async _leaveRoom() {')[1].split('/* DEV_TEST_START')[0];
  assert.match(leaveBlock, /exitRoomGone\(/);
  assert.doesNotMatch(leaveBlock, /await new Promise/);
});

test('非房主确认成员身份后才启动订阅，首次权威路由不会被跳过', async () => {
  const definition = loadPageDefinition();
  const originalWx = global.wx;
  let membershipConfirmedWhenPollingStarts = null;
  let followedInitialSnapshot = false;
  global.wx = {
    setStorageSync() {},
    preloadPage() {}
  };

  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    },
    _loadRoomDataAfterJoin: async () => ({
      ok: true,
      isHost: false,
      view: { route: { name: 'modeIndex', params: { modeId: 'partner' } } }
    }),
    _startMemberPolling() {
      membershipConfirmedWhenPollingStarts = this.data.membershipConfirmed;
    },
    _followRoomPageFromResult() {
      followedInitialSnapshot = true;
    },
    _preloadBrainstormMode() {}
  };

  try {
    page.onLoad({ roomId: '12345678' });
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.wx = originalWx;
  }

  assert.equal(membershipConfirmedWhenPollingStarts, true);
  assert.equal(followedInitialSnapshot, true);
});
