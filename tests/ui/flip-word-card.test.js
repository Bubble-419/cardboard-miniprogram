'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '../..', relativePath), 'utf8');
}

function loadComponent(relativePath) {
  const modulePath = path.resolve(__dirname, '../..', relativePath);
  const original = global.Component;
  let definition;
  global.Component = (value) => { definition = value; };
  delete require.cache[require.resolve(modulePath)];
  require(modulePath);
  delete require.cache[require.resolve(modulePath)];
  global.Component = original;
  return definition;
}

function createFlipCard(overrides = {}) {
  const definition = loadComponent('components/flip-word-card/index.js');
  const component = {
    data: {
      ...(definition.data || {}),
      cardState: 'back',
      showBackFace: true,
      animating: false,
      flipClass: '',
      ...(overrides.data || {})
    },
    properties: {},
    setData(patch) { Object.assign(this.data, patch); },
    ...definition.methods
  };
  Object.assign(component.data, {
    skipBack: false,
    twoFaceOnly: false,
    assignedWordSrc: 'a.png',
    assignedWordFallbackSrc: '',
    word1Src: 'b.png',
    word1FallbackSrc: '',
    backSrc: 'back.png',
    ...(overrides.data || {})
  });
  return component;
}

test('身份卡使用上下翻 rotateX，不再使用左右翻 rotateY', () => {
  const styles = read('components/flip-word-card/index.wxss');
  const markup = read('components/flip-word-card/index.wxml');

  assert.match(styles, /rotateX\(-90deg\)/);
  assert.match(styles, /rotateX\(90deg\)/);
  assert.match(styles, /\.flip-out-up/);
  assert.match(styles, /\.flip-out-down/);
  assert.doesNotMatch(styles, /rotateY/);
  assert.match(markup, /catchtouchstart="onTouchStart"/);
  assert.match(markup, /catchtouchmove="onTouchMove"/);
  assert.match(markup, /catchtouchend="onTouchEnd"/);
  assert.match(markup, /catchtap="onTap"/);
});

test('点击与上滑前进、下滑后退切换卡面', () => {
  const threeFace = createFlipCard({ data: { cardState: 'back' } });
  assert.equal(threeFace._nextState('back'), 'assignedWord');
  assert.equal(threeFace._nextState('assignedWord'), 'word1');
  assert.equal(threeFace._nextState('word1'), 'back');
  assert.equal(threeFace._prevState('assignedWord'), 'back');
  assert.equal(threeFace._prevState('word1'), 'assignedWord');
  assert.equal(threeFace._prevState('back'), 'word1');

  const twoFace = createFlipCard({ data: { cardState: 'back', twoFaceOnly: true } });
  assert.equal(twoFace._nextState('back'), 'assignedWord');
  assert.equal(twoFace._prevState('assignedWord'), 'back');

  const library = createFlipCard({ data: { skipBack: true, cardState: 'assignedWord' } });
  assert.equal(library._nextState('assignedWord'), 'word1');
  assert.equal(library._prevState('word1'), 'assignedWord');
  assert.equal(library._prevState('assignedWord'), 'word1');
});

test('发言页我的词语卡使用三面循环并接入背面图', () => {
  const markup = read('packageSpy/pages/speak/index.wxml');
  const myCard = markup.match(/my-word-card-frame[\s\S]*?<\/view>\s*<\/view>\s*<\/view>/)[0];
  assert.match(myCard, /<flip-word-card/);
  assert.match(myCard, /backSrc="\{\{cardBackSrc\}\}"/);
  assert.match(myCard, /assignedWordSrc="\{\{assignedWordSrc\}\}"/);
  assert.match(myCard, /word1Src="\{\{word1Src\}\}"/);
  assert.doesNotMatch(myCard, /twoFaceOnly/);
  assert.doesNotMatch(myCard, /skipBack/);
});

test('竖直滑动超过阈值才翻牌，水平滑动不触发', () => {
  const component = createFlipCard({
    data: {
      cardState: 'back',
      twoFaceOnly: true,
      assignedWordSrc: 'word.png'
    }
  });
  const flips = [];
  component._flipTo = (next, dir) => { flips.push({ next, dir }); };

  component.onTouchStart({
    changedTouches: [{ clientX: 100, clientY: 200 }]
  });
  component.onTouchEnd({
    changedTouches: [{ clientX: 180, clientY: 210 }]
  });
  assert.deepEqual(flips, []);

  component.onTouchStart({
    changedTouches: [{ clientX: 100, clientY: 200 }]
  });
  component.onTouchEnd({
    changedTouches: [{ clientX: 105, clientY: 140 }]
  });
  assert.deepEqual(flips, [{ next: 'assignedWord', dir: 'up' }]);

  flips.length = 0;
  component.data.cardState = 'assignedWord';
  component.onTouchStart({
    changedTouches: [{ clientX: 100, clientY: 120 }]
  });
  component.onTouchEnd({
    changedTouches: [{ clientX: 102, clientY: 180 }]
  });
  assert.deepEqual(flips, [{ next: 'back', dir: 'down' }]);
});

test('滑动翻牌后忽略紧随其后的 tap，避免连翻', () => {
  const component = createFlipCard({
    data: {
      cardState: 'back',
      twoFaceOnly: true,
      assignedWordSrc: 'word.png'
    }
  });
  const flips = [];
  component._flipTo = (next, dir) => { flips.push({ next, dir }); };

  component.onTouchStart({
    changedTouches: [{ clientX: 40, clientY: 80 }]
  });
  component.onTouchEnd({
    changedTouches: [{ clientX: 40, clientY: 20 }]
  });
  assert.equal(flips.length, 1);

  component.onTap();
  assert.equal(flips.length, 1, '滑动后的 tap 不应再次翻牌');
});

test('小位移点击在 touchend 即翻面，不依赖系统 tap', () => {
  const component = createFlipCard({
    data: {
      cardState: 'back',
      twoFaceOnly: true,
      assignedWordSrc: 'word.png'
    }
  });
  const flips = [];
  component._flipTo = (next, dir) => { flips.push({ next, dir }); };

  component.onTouchStart({
    changedTouches: [{ clientX: 120, clientY: 160 }]
  });
  component.onTouchEnd({
    changedTouches: [{ clientX: 124, clientY: 163 }]
  });
  assert.deepEqual(flips, [{ next: 'assignedWord', dir: 'up' }]);

  component.onTap();
  assert.equal(flips.length, 1, 'touchend 已翻面后的 tap 不应连翻');
});

test('发言页与牌库提示支持点击或上下滑动，并禁用侧滑返回', () => {
  const speakWxml = read('packageSpy/pages/speak/index.wxml');
  const libraryWxml = read('packageSpy/pages/cardLibrary/index.wxml');
  const speakJson = read('packageSpy/pages/speak/index.json');
  const libraryJson = read('packageSpy/pages/cardLibrary/index.json');

  assert.match(speakWxml, /点击或上下滑动/);
  assert.match(libraryWxml, /点击或上下滑动/);
  assert.match(speakJson, /"disableSwipeBack":\s*true/);
  assert.match(libraryJson, /"disableSwipeBack":\s*true/);
});

test('谁是卧底牌库按四类分组且编号归属正确', () => {
  const {
    listLibraryCategories,
    getLibraryGroupCount
  } = require('../../packageSpy/utils/spyWordCardAssets');

  const categories = listLibraryCategories();
  assert.equal(getLibraryGroupCount(), 36);
  assert.deepEqual(
    categories.map((item) => ({ id: item.id, title: item.title, count: item.count })),
    [
      { id: 'click', title: '点击类', count: 9 },
      { id: 'motion', title: '位移类', count: 9 },
      { id: 'multi', title: '多维协同', count: 9 },
      { id: 'conflict', title: '冲突调和', count: 9 }
    ]
  );
  assert.deepEqual(
    categories.map((item) => item.cards.map((card) => card.displayName)),
    [
      ['开关', '单击', '按下', '持续触发', '长按', '双击', '多点开关', '多点有序点击', '多点同时点击'],
      ['拖拽', '甩动', '翻动', '滑动切换', '越界切换', '晃动/震动', '捏合缩放', '环绕旋转', '整体移动'],
      ['限位点击', '长按拖拽', '双按拖拽', '轻扫切换', '域控式移动', '力速调幅', '异位连触', '向量菜单', '动势点选'],
      ['快击', '点击缓冲', '缓冲连发', '边缘滑入', '滑入停留', '方向解耦', '轻拨', '点拖互斥', '捏合解耦']
    ]
  );

  const libraryWxml = read('packageSpy/pages/cardLibrary/index.wxml');
  assert.match(libraryWxml, /wx:for="\{\{categories\}\}"/);
  assert.match(libraryWxml, /category-title/);
});
