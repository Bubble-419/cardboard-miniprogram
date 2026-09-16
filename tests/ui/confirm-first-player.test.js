'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = {
  globalData: {
    roomId: '12345678',
    gameMode: 'partner'
  }
};

global.getApp = () => app;

function loadPageDefinition(modulePath) {
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  global.wx = {
    showToast() {},
    redirectTo() {},
    navigateBack() {}
  };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  return definition;
}

function makePage(definition, data = {}) {
  return {
    ...definition,
    data: {
      ...definition.data,
      ...data
    },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

test('确认首位页进入时不预选 SELECT_FIRST_PLAYER 已经提出的玩家', async () => {
  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/confirmFirstPlayer/index');
  const page = makePage(definition, {
    roomId: '12345678',
    isHost: true,
    isWaiting: false
  });

  await page.loadRoomData({
    ok: true,
    isHost: true,
    memberCount: 3,
    workshopName: '测试工作坊',
    members: [
      { memberId: 'm1', playerIndex: 1, nickName: '房主' },
      { memberId: 'm2', playerIndex: 2, nickName: '玩家2' }
    ],
    view: {
      session: {
        setup: { proposedFirstMemberId: 'm2' }
      }
    }
  });

  assert.equal(page.data.selectedPlayerIndex, null);
  assert.equal(page.data.selectedPlayerName, '');
  assert.equal(page.data.canConfirm, false);
});

test('确认首位页允许房主重新点选，即使服务端已有 proposedFirstMemberId', async () => {
  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/confirmFirstPlayer/index');
  const page = makePage(definition, {
    roomId: '12345678',
    isHost: true,
    isWaiting: false
  });

  await page.loadRoomData({
    ok: true,
    isHost: true,
    members: [
      { memberId: 'm1', playerIndex: 1, nickName: '房主', avatarImage: '/a.png' },
      { memberId: 'm2', playerIndex: 2, nickName: '玩家2', avatarImage: '/b.png' }
    ],
    view: {
      session: {
        setup: { proposedFirstMemberId: 'm2' }
      }
    }
  });

  page.onSlotTap({ currentTarget: { dataset: { index: 0 } } });
  assert.equal(page.data.selectedPlayerIndex, 1);
  assert.equal(page.data.canConfirm, true);
});

test('确认首位页不再自己拼 gamepage URL，主副屏都跟 view.route', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/confirmFirstPlayer/index.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /buildGamepageUrl/);
  assert.doesNotMatch(source, /page === 'gamepage'/);
  assert.doesNotMatch(
    source,
    /selectedPlayerIndex:\s*proposed/,
    '快照不得把 proposedFirstMemberId 写成默认选中'
  );
});
