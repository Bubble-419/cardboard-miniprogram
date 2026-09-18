const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../..');

/** 这些页面只有进入页后的自动跳转/轮询，没有用户可重复触发的交互。 */
const AUTO_ONLY_ROUTES = new Set([
  'pages/auth/index',
  'pages/sub-pages/subAwait/index'
]);

function getRegisteredRoutes() {
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8')
  );
  return [
    ...(appConfig.pages || []),
    ...(appConfig.subPackages || []).flatMap((pkg) => {
      return (pkg.pages || []).map((page) => `${pkg.root}/${page}`);
    })
  ];
}

function getBoundHandlers(wxml) {
  const names = new Set();
  const eventPattern = /(?:bind|catch)(?::[\w-]+|[\w-]+)="([^"]+)"/g;
  let match;
  while ((match = eventPattern.exec(wxml))) names.add(match[1]);
  return [...names].filter((name) => ![
    'noop',
    'preventMove',
    'true'
  ].includes(name));
}

test('every registered interactive page includes the reusable full-page lock', () => {
  const missing = [];
  for (const route of getRegisteredRoutes()) {
    if (AUTO_ONLY_ROUTES.has(route)) continue;
    const js = fs.readFileSync(path.join(projectRoot, `${route}.js`), 'utf8');
    const wxml = fs.readFileSync(path.join(projectRoot, `${route}.wxml`), 'utf8');
    if (!js.includes('pageInteractionLock') || !wxml.includes('interaction-lock-layer')) {
      missing.push(route);
    }
  }
  assert.deepEqual(missing, []);
});

test('decorated pages guard every WXML interaction while a request is active', () => {
  const failures = [];
  for (const route of getRegisteredRoutes()) {
    const jsPath = path.join(projectRoot, `${route}.js`);
    const wxmlPath = path.join(projectRoot, `${route}.wxml`);
    const js = fs.readFileSync(jsPath, 'utf8');
    if (!js.includes('Page(withPageInteractionLock')) continue;

    const marker = js.lastIndexOf('}, [');
    assert.notEqual(marker, -1, `${route} 缺少交互处理器声明`);
    const guarded = new Set(
      [...js.slice(marker).matchAll(/'([^']+)'/g)].map((match) => match[1])
    );
    const wxml = fs.readFileSync(wxmlPath, 'utf8');
    const unguarded = getBoundHandlers(wxml).filter((name) => !guarded.has(name));
    if (unguarded.length) failures.push({ route, unguarded });
  }
  assert.deepEqual(failures, []);
});
