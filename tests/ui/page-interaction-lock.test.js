const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runPageInteraction,
  runPageNavigation,
  withPageInteractionLock
} = require('../../utils/pageInteractionLock');

function makePage() {
  return {
    data: {},
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('locks immediately and delays the loading indicator', async () => {
  const page = makePage();
  let finish;
  const task = new Promise((resolve) => {
    finish = resolve;
  });

  const running = runPageInteraction(page, () => task, {
    loadingDelayMs: 20,
    loadingText: '正在打开…'
  });

  assert.equal(page.data.interactionLocked, true);
  assert.equal(page.data.interactionLoading, false);
  assert.equal(page.data.interactionLoadingText, '正在打开…');

  await wait(30);
  assert.equal(page.data.interactionLoading, true);

  finish('done');
  assert.equal(await running, 'done');
  assert.equal(page.data.interactionLocked, false);
  assert.equal(page.data.interactionLoading, false);
});

test('does not start a second task while the page is locked', async () => {
  const page = makePage();
  let finish;
  let calls = 0;
  const first = runPageInteraction(page, () => {
    calls += 1;
    return new Promise((resolve) => {
      finish = resolve;
    });
  }, { loadingDelayMs: 100 });

  const second = runPageInteraction(page, () => {
    calls += 1;
  }, { loadingDelayMs: 100 });

  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  finish();
  await first;
  assert.equal(page.data.interactionLocked, false);
});

test('never shows loading when the task finishes within the delay', async () => {
  const page = makePage();

  await runPageInteraction(page, async () => 'fast', {
    loadingDelayMs: 20
  });
  await wait(30);

  assert.equal(page.data.interactionLocked, false);
  assert.equal(page.data.interactionLoading, false);
});

test('unlocks the page when the task rejects', async () => {
  const page = makePage();

  await assert.rejects(
    runPageInteraction(page, async () => {
      throw new Error('request failed');
    }, { loadingDelayMs: 20 }),
    /request failed/
  );

  assert.equal(page.data.interactionLocked, false);
  assert.equal(page.data.interactionLoading, false);
});

test('waits for the navigation success callback', async () => {
  const originalWx = global.wx;
  let succeed;
  global.wx = {
    navigateTo(options) {
      succeed = () => options.success({ route: 'next' });
    }
  };

  try {
    let settled = false;
    const page = makePage();
    const navigation = runPageNavigation(page, async () => ({
      method: 'navigateTo',
      url: '/next'
    }))
      .then((result) => {
        settled = true;
        return result;
      });

    await Promise.resolve();
    assert.equal(settled, false);
    await new Promise((resolve) => setImmediate(resolve));
    succeed();
    assert.deepEqual(await navigation, {
      ok: true,
      result: { route: 'next' }
    });
  } finally {
    global.wx = originalWx;
  }
});

test('finishes when navigation fails so the page can unlock', async () => {
  const originalWx = global.wx;
  const navigationError = new Error('navigation failed');
  global.wx = {
    redirectTo(options) {
      options.fail(navigationError);
    }
  };

  try {
    const page = makePage();
    assert.deepEqual(
      await runPageNavigation(page, async () => ({
        method: 'redirectTo',
        url: '/next'
      })),
      { ok: false, error: navigationError }
    );
    assert.equal(page.data.interactionLocked, false);
  } finally {
    global.wx = originalWx;
  }
});

test('guards every declared page interaction with the same page lock', async () => {
  let otherCalls = 0;
  let finish;
  const definition = withPageInteractionLock({
    data: { value: 1 },
    startRequest() {
      return runPageInteraction(this, () => new Promise((resolve) => {
        finish = resolve;
      }));
    },
    otherButton() {
      otherCalls += 1;
    }
  }, ['startRequest', 'otherButton']);
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };

  const running = page.startRequest();
  page.startRequest();
  page.otherButton();

  assert.equal(page.data.interactionLocked, true);
  assert.equal(otherCalls, 0);
  await Promise.resolve();
  finish();
  await running;

  page.otherButton();
  assert.equal(otherCalls, 1);
});

test('键盘高度和焦点回调在页面锁期间仍然执行', async () => {
  let heightCalls = 0;
  let finish;
  const definition = withPageInteractionLock({
    data: {},
    startRequest() {
      return runPageInteraction(this, () => new Promise((resolve) => {
        finish = resolve;
      }));
    },
    onInspirationKeyboardHeightChange() {
      heightCalls += 1;
    }
  }, ['startRequest', 'onInspirationKeyboardHeightChange'], {
    passthroughMethods: ['onInspirationKeyboardHeightChange']
  });
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  const running = page.startRequest();
  assert.equal(page.data.interactionLocked, true);
  page.onInspirationKeyboardHeightChange({ detail: { height: 300 } });
  assert.equal(heightCalls, 1);
  await Promise.resolve();
  finish();
  await running;
});

test('名称看起来像输入回调的方法也必须显式声明后才能穿透页面锁', async () => {
  let inputCalls = 0;
  let finish;
  const definition = withPageInteractionLock({
    data: {},
    startRequest() {
      return runPageInteraction(this, () => new Promise((resolve) => { finish = resolve; }));
    },
    onRoomNameInput() { inputCalls += 1; }
  }, ['startRequest', 'onRoomNameInput']);
  const page = { ...definition, data: {}, setData(patch) { Object.assign(this.data, patch); } };

  const running = page.startRequest();
  page.onRoomNameInput({ detail: { value: '不会误穿透' } });
  assert.equal(inputCalls, 0);
  await Promise.resolve();
  finish();
  await running;
});
