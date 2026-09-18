'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function loadPageDefinition(modulePath, wxMock = {}) {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  const originalGetCurrentPages = global.getCurrentPages;
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  global.getApp = () => ({ globalData: {} });
  global.getCurrentPages = () => [];
  global.wx = {
    nextTick(fn) { fn(); },
    showToast() {},
    getStorageSync() { return []; },
    setStorageSync() {},
    getWindowInfo() { return { windowHeight: 800, screenHeight: 800, statusBarHeight: 44 }; },
    getMenuButtonBoundingClientRect() {
      return { top: 48, height: 32, width: 87, right: 360 };
    },
    ...wxMock
  };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  delete require.cache[require.resolve(modulePath)];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  global.getCurrentPages = originalGetCurrentPages;
  return definition;
}

function withPageWx(run) {
  const originalWx = global.wx;
  global.wx = {
    nextTick(fn) { fn(); },
    showToast() {},
    getStorageSync() { return []; },
    setStorageSync() {}
  };
  try {
    return run();
  } finally {
    global.wx = originalWx;
  }
}

function makePage(definition, data = {}) {
  const page = {
    ...definition,
    data: { ...definition.data, ...data },
    setData(patch, cb) {
      Object.assign(this.data, patch);
      if (typeof cb === 'function') cb();
    }
  };
  Object.keys(definition).forEach((key) => {
    if (typeof definition[key] === 'function') {
      page[key] = definition[key].bind(page);
    }
  });
  return page;
}

test('全局回顾展示全部纪要卡、允许横滑，并返回排行榜', () => {
  const wxml = read('pages/main-pages/partnerMode/gamepage/index.wxml');
  const js = read('pages/main-pages/partnerMode/gamepage/index.js');
  assert.match(wxml, /disable-touch="\{\{isHistoryReview \? reviewInnerScrolling/);
  assert.match(wxml, /scroll-y="\{\{!isHistoryReview \|\| reviewCardScrollY\}\}"/);
  assert.match(wxml, /wx:if="\{\{isHistoryReview\}\}"[\s\S]*bindtap="handleGoBack"/);
  assert.match(
    wxml,
    /wx:if="\{\{isHistoryReview\}\}"[\s\S]*?icon-room-entry-gp\.svg/,
    '回顾态左上角应使用房间页入口图标，而不是返回箭头'
  );
  assert.doesNotMatch(wxml, /icon-special-back\.svg/);
  assert.match(js, /expectedPrev:\s*'pages\/leaderboard\/index'/);
  assert.match(js, /if \(isReview\) return true/);
  assert.match(js, /innerScrollLocked:\s*false/);
  assert.match(js, /onApplied:\s*isHistoryReview/);
  assert.match(js, /_finalizeHistoryReviewUi/);
});

test('收尾全局回顾绑定当前 Session，不猜测最近的历史场次', async () => {
  const js = read('pages/main-pages/partnerMode/gamepage/index.js');
  assert.doesNotMatch(js, /getRoomHistory/);
  assert.doesNotMatch(js, /getReviewSnapshot/);

  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
  const page = makePage(definition, { roomId: '12345678', sessionId: 'session-current' });
  page._persistHistoryReviewSnapshot = () => {};
  page._prepareLeavePage = () => {};

  const originalWx = global.wx;
  let targetUrl = '';
  global.wx = {
    showToast() {},
    navigateTo(options) {
      targetUrl = options.url;
      options.success({});
    }
  };
  try {
    await page.handleGlobalReview();
  } finally {
    global.wx = originalWx;
  }

  assert.match(targetUrl, /roomId=12345678/);
  assert.match(targetUrl, /sessionId=session-current/);
  assert.match(targetUrl, /mode=review/);
  assert.match(targetUrl, /from=closing/);
});

test('收尾全局回顾返回路由仍携带当前 Session', async () => {
  const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
  const page = makePage(definition, {
    roomId: '12345678',
    sessionId: 'session-current',
    currentPlayerIndex: 2
  });
  page._reviewReturnUrl = '';
  page._prepareLeavePage = () => {};

  const originalWx = global.wx;
  const originalGetCurrentPages = global.getCurrentPages;
  let targetUrl = '';
  global.getCurrentPages = () => [];
  global.wx = {
    showToast() {},
    redirectTo(options) {
      targetUrl = options.url;
      options.success({});
    }
  };
  try {
    await page.handleReviewBack();
  } finally {
    global.wx = originalWx;
    global.getCurrentPages = originalGetCurrentPages;
  }

  assert.match(targetUrl, /phase=closing/);
  assert.match(targetUrl, /closingStep=review/);
  assert.match(targetUrl, /sessionId=session-current/);
});

test('全局回顾 _buildDisplayCardState 保留全部纪要卡并可横滑', () => {
  withPageWx(() => {
    const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
    const page = makePage(definition, { isHistoryReview: true, roomId: 'r1' });
    page._isHistoryReview = true;
    const state = page._buildDisplayCardState({
      roundSummaries: [
        { round: 1, playerIndex: 1, playerName: '甲', playHistory: ['一'] },
        { round: 2, playerIndex: 2, playerName: '乙', playHistory: ['二'] },
        { round: 3, playerIndex: 3, playerName: '丙', playHistory: ['三'] }
      ],
      members: [
        { playerIndex: 1, nickName: '甲' },
        { playerIndex: 2, nickName: '乙' },
        { playerIndex: 3, nickName: '丙' }
      ],
      currentPlayerIndex: 1,
      preferredCardIndex: 0,
      historyReview: true,
      roomId: 'r1'
    });
    assert.equal(state.displayRoundSummaries.length, 3);
    assert.equal(state.cardCount, 3);
    assert.equal(state.showCurrentActionCard, false);
    assert.equal(state.cardIndex, 0);
  });
});

test('全局回顾 finalize 使用已经落地的纪要数量，不会把 cardCount 打成 1', () => {
  withPageWx(() => {
    const definition = loadPageDefinition('../../pages/main-pages/partnerMode/gamepage/index');
    const page = makePage(definition, {
      isHistoryReview: true,
      displayRoundSummaries: [
        { round: 1, playerIndex: 1, playerName: '甲' },
        { round: 2, playerIndex: 2, playerName: '乙' },
        { round: 3, playerIndex: 3, playerName: '丙' }
      ],
      cardIndex: 0,
      cardCount: 3
    });
    page._isHistoryReview = true;
    page._checkProblemTextOverflow = () => {};
    page._scheduleReviewTimeout = () => {};
    page._refreshInspirationCount = () => {};
    page._finalizeHistoryReviewUi('设计问题');
    assert.equal(page.data.cardCount, 3);
    assert.equal(page.data.displayRoundSummaries.length, 3);
    assert.equal(page.data.gamepagePhase, 'play');
  });
});
