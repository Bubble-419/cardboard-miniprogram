'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadPageDefinition() {
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  const originalWx = global.wx;
  let definition;
  global.Page = (value) => { definition = value; };
  global.getApp = () => ({ globalData: {} });
  global.wx = { showToast() {} };
  const modulePath = require.resolve('../../pages/leaderboard/index');
  delete require.cache[modulePath];
  require(modulePath);
  delete require.cache[modulePath];
  global.Page = originalPage;
  global.getApp = originalGetApp;
  global.wx = originalWx;
  return definition;
}

function makePage(definition) {
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  return page;
}

test('排行榜的评分次数累加每个 Turn 的实际评分人数', () => {
  const page = makePage(loadPageDefinition());
  page._applySnapshot({
    ok: true,
    isHost: true,
    members: [
      { memberId: 'm1', playerIndex: 1, nickName: '玩家1' },
      { memberId: 'm2', playerIndex: 2, nickName: '玩家2' }
    ],
    view: {
      session: {
        sessionId: 's1',
        participants: [],
        turnSummaries: [
          { turnId: 't1', activeMemberId: 'm1', scoredCount: 2 },
          { turnId: 't2', activeMemberId: 'm1', scoredCount: 3 },
          { turnId: 't3', activeMemberId: 'm2', scoredCount: 1 }
        ],
        result: {
          leaderboard: [
            { memberId: 'm1', totalStars: 18 },
            { memberId: 'm2', totalStars: 4 }
          ]
        }
      }
    }
  });

  assert.equal(page.data.leaderboard.find((item) => item.memberId === 'm1').scoreCount, 5);
  assert.equal(page.data.leaderboard.find((item) => item.memberId === 'm2').scoreCount, 1);
});
