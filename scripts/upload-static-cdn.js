'use strict';

/**
 * 把代码包忽略的插图上传到云存储 miniprogram-static/ 根下（按文件名平铺），供 HTTPS 引入。
 *
 * 优先使用本机已登录的 `tcb` CLI；也可设置 TENCENTCLOUD_SECRETID / TENCENTCLOUD_SECRETKEY
 * 后配合 @cloudbase/manager-node。两者都没有时打印控制台手工上传步骤。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  CLOUD_ENV_ID,
  STATIC_PREFIX,
  cloudStaticUrl
} = require('../utils/staticCdn');

const ROOT = path.join(__dirname, '..');

const ENTRIES = [
  { type: 'dir', rel: 'packageSpy/assets/interactionCards/webp' },
  { type: 'file', rel: 'assets/subAwait/wait-hero-5a8ea5.webp' },
  { type: 'file', rel: 'assets/home/empty-history-6f27f1.webp' },
  { type: 'file', rel: 'assets/brainstormMode/mode-cover-halligalli.jpg' },
  { type: 'file', rel: 'assets/brainstormMode/mode-cover-partner.jpg' },
  { type: 'file', rel: 'assets/brainstormMode/mode-cover-spy.jpg' },
  { type: 'file', rel: 'assets/halliGalli/step-deal.webp' },
  { type: 'file', rel: 'assets/halliGalli/step-flip.webp' },
  { type: 'file', rel: 'assets/halliGalli/step-ring.webp' },
  { type: 'file', rel: 'assets/halliGalli/step-play.webp' },
  { type: 'file', rel: 'assets/halliGalli/step-vote.webp' },
  { type: 'file', rel: 'assets/halliGalli/step-judge.webp' }
];

function listFiles() {
  const out = [];
  ENTRIES.forEach((entry) => {
    const abs = path.join(ROOT, entry.rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`missing static file: ${entry.rel}`);
    }
    if (entry.type === 'file') {
      out.push(entry.rel.replace(/\\/g, '/'));
      return;
    }
    fs.readdirSync(abs).forEach((name) => {
      const child = path.join(abs, name);
      if (fs.statSync(child).isFile()) {
        out.push(path.relative(ROOT, child).replace(/\\/g, '/'));
      }
    });
  });
  return out.sort();
}

function cloudPathFor(rel) {
  const name = rel.replace(/\\/g, '/').split('/').filter(Boolean).pop();
  return `${STATIC_PREFIX}/${name}`;
}

function printManual(files) {
  const sample = cloudStaticUrl(files[0]);
  console.log(`需要把 ${files.length} 个插图上传到云环境 ${CLOUD_ENV_ID}`);
  console.log('云开发控制台 → 云存储 → 上传到 miniprogram-static/ 根目录，只保留文件名：');
  console.log(`  ${STATIC_PREFIX}/<filename>`);
  console.log('存储安全规则需允许读取该前缀（所有用户可读，或等价公开读）。');
  console.log('示例 URL：');
  console.log(`  ${sample}`);
  console.log('文件清单：');
  files.forEach((rel) => {
    console.log(`  ${rel} -> ${cloudPathFor(rel)}`);
  });
}

function runTcb(files) {
  const probe = spawnSync('tcb', ['-v'], { encoding: 'utf8', shell: true });
  if (probe.error || probe.status !== 0) return false;
  let failed = 0;
  files.forEach((rel) => {
    const local = path.join(ROOT, rel);
    const cloudPath = cloudPathFor(rel);
    const result = spawnSync(
      'tcb',
      ['storage', 'upload', local, cloudPath, '-e', CLOUD_ENV_ID],
      { encoding: 'utf8', shell: true, cwd: ROOT }
    );
    if (result.status !== 0) {
      failed += 1;
      console.warn(rel, result.stderr || result.stdout || 'tcb upload failed');
      return;
    }
    console.log('uploaded', cloudPath);
  });
  return failed === 0;
}

async function runManager(files) {
  const secretId = process.env.TENCENTCLOUD_SECRETID;
  const secretKey = process.env.TENCENTCLOUD_SECRETKEY;
  if (!secretId || !secretKey) return false;
  let CloudBase;
  try {
    CloudBase = require('@cloudbase/manager-node');
  } catch (e) {
    console.warn('@cloudbase/manager-node 未安装，跳过 SDK 上传');
    return false;
  }
  const app = CloudBase.init({
    secretId,
    secretKey,
    envId: CLOUD_ENV_ID
  });
  for (let i = 0; i < files.length; i += 1) {
    const rel = files[i];
    const localPath = path.join(ROOT, rel);
    const cloudPath = cloudPathFor(rel);
    if (typeof app.storage.uploadFile === 'function') {
      await app.storage.uploadFile({ localPath, cloudPath });
    } else if (typeof app.storage.upload === 'function') {
      await app.storage.upload(localPath, cloudPath);
    } else {
      throw new Error('unsupported @cloudbase/manager-node storage API');
    }
    console.log('uploaded', cloudPath);
  }
  return true;
}

async function main() {
  const files = listFiles();
  if (!files.length) throw new Error('no static files to upload');
  if (await runManager(files)) {
    console.log(`done ${files.length} files via manager-node`);
    return;
  }
  if (runTcb(files)) {
    console.log(`done ${files.length} files via tcb`);
    return;
  }
  printManual(files);
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
