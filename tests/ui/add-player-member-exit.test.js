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
