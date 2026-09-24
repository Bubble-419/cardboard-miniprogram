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

test('确认首位页上一页会提交 RESET_FIRST_PLAYER 并跟随权威 route', async () => {
  const commands = [];
  let redirectUrl = '';
  const previousPages = global.getCurrentPages;
  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/confirmFirstPlayer/index');
  global.getCurrentPages = () => [{
    route: 'pages/main-pages/partnerMode/confirmFirstPlayer/index',
    data: {}
  }];
  global.wx = {
    showToast() {},
    redirectTo(options) {
      redirectUrl = options.url;
      if (typeof options.complete === 'function') options.complete({});
      else if (typeof options.success === 'function') options.success({});
    }
  };
  app.globalData.roomSession = {
    roomId: '12345678',
    dispatch: async (command) => {
      commands.push(command);
      return { ok: true, outcome: { committedThroughSeq: 12 } };
    },
    getView: () => ({
      actor: { capabilities: { RESET_FIRST_PLAYER: { allowed: true } } },
      session: { sessionId: 's1', workflow: { step: 'CONFIRM_FIRST_PLAYER', revision: 4 } },
      navigation: { back: { kind: 'COMMAND', commandType: 'RESET_FIRST_PLAYER',
        context: { sessionId: 's1', workflowRevision: 4 }, after: 'FOLLOW_ROUTE' } }
    }),
    getSnapshot: () => ({
      ok: true,
      roomId: '12345678',
      revision: 12,
      view: { route: { name: 'selectPlayer', params: { phase: 'SELECT_FIRST_PLAYER' } } }
    })
  };
  const page = makePage(definition, {
    roomId: '12345678',
    isHost: true
  });
  try {
    await page.handleGoBack();
    assert.equal(commands[0].type, 'RESET_FIRST_PLAYER');
    assert.deepEqual(commands[0].context, { sessionId: 's1', workflowRevision: 4 });
    assert.match(redirectUrl, /selectPlayer/);
  } finally {
    global.getCurrentPages = previousPages;
    delete app.globalData.roomSession;
  }
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

test('首位玩家选中态保留数字 1，并使用头像级高亮与单选语义', () => {
  const wxml = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/confirmFirstPlayer/index.wxml'),
    'utf8'
  );
  const wxss = fs.readFileSync(
    path.resolve(__dirname, '../../pages/main-pages/partnerMode/confirmFirstPlayer/index.wxss'),
    'utf8'
  );

  assert.match(wxml, /aria-role="radio"/);
  assert.match(wxml, /aria-checked="\{\{item\.member\.playerIndex === selectedPlayerIndex\}\}"/);
  assert.match(wxml, /class="first-player-badge-num">1<\/text>/);
  assert.match(wxss, /\.avatar-slot-selected \.avatar-wrap\s*\{/);
  assert.match(wxss, /@keyframes first-player-select-pop/);
  assert.match(wxss, /\.avatar-slot-selected \.avatar-name-wrap\s*\{/);
  assert.match(wxss, /\.avatar-slot-selected\.avatar-slot-me::before\s*\{/);
  assert.doesNotMatch(wxss, /\.avatar-slot-selected\s*\{[^}]*transform:/s);
});
