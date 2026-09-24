'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');

function collectWxmlFiles(relativeDir) {
  const dir = path.join(ROOT, relativeDir);
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectWxmlFiles(relativePath);
    return entry.isFile() && entry.name.endsWith('.wxml') ? [relativePath] : [];
  });
}

function collectTextControls() {
  return ['pages', 'components']
    .flatMap(collectWxmlFiles)
    .flatMap((file) => {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const tags = source.match(/<(?:input|textarea)\b[\s\S]*?(?:\/>|<\/(?:input|textarea)>)/g) || [];
      return tags.map((markup, index) => ({ file, index: index + 1, markup }));
    });
}

test('所有文本输入控件显式启用系统键盘避让并声明光标安全间距', () => {
  const controls = collectTextControls();
  assert.ok(controls.length > 0);

  const unsafe = controls.filter(({ markup }) => {
    const adjustPosition = markup.match(/adjust-position="([^\"]+)"/);
    const manuallyLifted = adjustPosition && /false/.test(adjustPosition[1]);
    return !adjustPosition
      || !/cursor-spacing="\d+"/.test(markup)
      || (manuallyLifted && !/bindkeyboardheightchange="[^"]+"/.test(markup));
  });

  assert.deepEqual(
    unsafe.map(({ file, index }) => `${file}#${index}`),
    [],
    '输入框必须显式选择系统避让或键盘高度驱动的手动避让，并声明光标安全间距'
  );
});
