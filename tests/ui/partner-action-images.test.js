const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const imagePaths = [
  'assets/partnerMode/actions/action-play.jpg',
  'assets/partnerMode/actions/action-delete.jpg',
  'assets/partnerMode/actions/action-move.jpg',
  'assets/partnerMode/actions/action-swap.jpg'
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5)
      };
    }
    offset += 2 + segmentLength;
  }
  throw new Error('JPEG dimensions not found');
}

test('regular and silent action rules render CDN illustrations without cropping', () => {
  const templates = [
    read('pages/main-pages/partnerMode/gamepage/index.wxml'),
    read('pages/main-pages/partnerMode/specialMove/index.wxml')
  ];
  const scripts = [
    read('pages/main-pages/partnerMode/gamepage/index.js'),
    read('pages/main-pages/partnerMode/specialMove/index.js')
  ];

  for (const imagePath of imagePaths) {
    scripts.forEach((script) => assert.ok(script.includes(`staticCdnUrl('${imagePath}')`)));
    templates.forEach((template) => assert.doesNotMatch(template, new RegExp(`/${imagePath}`)));
  }
  assert.equal(templates.reduce((count, template) => count + (template.match(/class="(?:action|silent-action)-illus"[^>]+mode="aspectFit"/g) || []).length, 0), 8);
});

test('all action-rule image sources retain a 4:3 JPEG canvas', () => {
  for (const imagePath of imagePaths) {
    const absolutePath = path.join(root, imagePath);
    const buffer = fs.readFileSync(absolutePath);

    assert.equal(buffer[0], 0xff);
    assert.equal(buffer[1], 0xd8);
    assert.ok(buffer.length > 10_000);
    assert.ok(buffer.length < 100_000);
    assert.deepEqual(readJpegSize(buffer), { width: 724, height: 543 });
  }

  const gameStyles = read('pages/main-pages/partnerMode/gamepage/index.wxss');
  const specialStyles = read('pages/main-pages/partnerMode/specialMove/index.wxss');
  assert.match(gameStyles, /\.action-illus\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
  assert.match(specialStyles, /\.silent-action-illus\s*\{[\s\S]*?aspect-ratio:\s*4\s*\/\s*3/);
});
