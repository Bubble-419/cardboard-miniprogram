'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const FILE_ID = 'cloud://cardboard-miniprogram-6a13aab073.6361-cardboard-miniprogram-6a13aab073-1307472735/avatars/1785217589975_34338.jpg';
const HTTPS_URL = 'https://6361-cardboard-miniprogram-6a13aab073-1307472735.tcb.qcloud.la/avatars/1785217589975_34338.jpg';
const DEFAULT_AVATAR = '/assets/home/user-avatar-default.png';

function emptyDownloadError() {
  const err = new Error('internal server error: empty download url');
  err.errCode = -403003;
  err.errMsg = 'internal server error: empty download url';
  return err;
}

function fileIdFromList(fileList) {
  const first = fileList && fileList[0];
  return typeof first === 'string' ? first : first && first.fileID;
}

function loadResolver(cloud) {
  const app = { globalData: { cloud, cloudReady: Promise.resolve() } };
  global.getApp = () => app;
  global.wx = { cloud };
  const modPath = require.resolve('../../utils/cloudDisplayUrl');
  const apiPath = require.resolve('../../utils/cloudApi');
  delete require.cache[modPath];
  delete require.cache[apiPath];
  return require(modPath);
}

test('sanitizeImageSrc 拒绝把 cloud:// 交给 <image>', () => {
  const { sanitizeImageSrc } = loadResolver({
    async downloadFile() { throw new Error('should not download'); },
    async getTempFileURL() { throw new Error('should not fetch'); }
  });
  assert.equal(sanitizeImageSrc(FILE_ID, DEFAULT_AVATAR), DEFAULT_AVATAR);
  assert.equal(sanitizeImageSrc(HTTPS_URL, DEFAULT_AVATAR), HTTPS_URL);
});

test('getTempFileURL 成功时不再走会报 empty download url 的 downloadFile', async () => {
  const calls = { download: 0, temp: 0 };
  const cloud = {
    async downloadFile() {
      calls.download += 1;
      throw emptyDownloadError();
    },
    async getTempFileURL({ fileList }) {
      calls.temp += 1;
      return {
        fileList: [{ fileID: fileIdFromList(fileList), tempFileURL: HTTPS_URL, status: 0 }]
      };
    }
  };
  const { resolveCloudDisplayUrl } = loadResolver(cloud);
  const url = await resolveCloudDisplayUrl(FILE_ID);
  assert.equal(calls.temp, 1);
  assert.equal(calls.download, 0);
  assert.equal(url, HTTPS_URL);
});

test('getTempFileURL 返回的 fileID 与请求不完全一致时仍能命中缓存', async () => {
  const cloud = {
    async downloadFile() {
      throw emptyDownloadError();
    },
    async getTempFileURL() {
      return {
        fileList: [{
          fileID: `${FILE_ID}?`,
          tempFileURL: HTTPS_URL,
          status: 0
        }]
      };
    }
  };
  const { resolveCloudDisplayUrl } = loadResolver(cloud);
  const url = await resolveCloudDisplayUrl(FILE_ID);
  assert.equal(url, HTTPS_URL);
});

test('客户端 downloadFile/getTempFileURL 都失败时回退云函数临时链', async () => {
  const cloud = {
    async downloadFile() {
      throw emptyDownloadError();
    },
    async getTempFileURL({ fileList }) {
      return {
        fileList: [{
          fileID: fileIdFromList(fileList),
          tempFileURL: '',
          status: -403003,
          errMsg: 'internal server error: empty download url'
        }]
      };
    },
    async callFunction({ name, data }) {
      assert.equal(name, 'roomMedia');
      assert.equal(data.action, 'tempUrls');
      return {
        result: {
          ok: true,
          fileList: (data.fileList || []).map((fileID) => ({
            fileID,
            tempFileURL: HTTPS_URL,
            status: 0
          }))
        }
      };
    }
  };
  const { resolveCloudDisplayUrl } = loadResolver(cloud);
  const url = await resolveCloudDisplayUrl(FILE_ID);
  assert.equal(url, HTTPS_URL);
});

test('downloadFile 与 getTempFileURL 与云函数都拿不到地址时展示为空', async () => {
  const cloud = {
    async downloadFile() {
      throw emptyDownloadError();
    },
    async getTempFileURL({ fileList }) {
      return {
        fileList: [{
          fileID: fileIdFromList(fileList),
          tempFileURL: '',
          status: -403003,
          errMsg: 'internal server error: empty download url'
        }]
      };
    },
    async callFunction() {
      return {
        result: {
          ok: true,
          fileList: [{
            fileID: FILE_ID,
            tempFileURL: '',
            status: -403003,
            errMsg: 'internal server error: empty download url'
          }]
        }
      };
    }
  };
  const { resolveCloudDisplayUrl } = loadResolver(cloud);
  const url = await resolveCloudDisplayUrl(FILE_ID);
  assert.equal(url, '');
});

test('首页恢复资料时不会把 cloud:// 写进 <image src>', () => {
  const app = { globalData: { roomId: null, cloud: null, cloudReady: Promise.resolve() } };
  const storage = new Map();
  storage.set('wxUserProfile', {
    nickName: '测试用户',
    avatarUrl: FILE_ID,
    avatarFileID: FILE_ID
  });
  global.getApp = () => app;
  global.getCurrentPages = () => [{ route: 'pages/main-pages/aaa/index' }];
  global.wx = {
    getStorageSync(key) { return storage.get(key); },
    setStorageSync(key, value) { storage.set(key, value); },
    removeStorageSync(key) { storage.delete(key); },
    showToast() {},
    cloud: {
      async downloadFile() { throw emptyDownloadError(); },
      async getTempFileURL() {
        return { fileList: [{ fileID: FILE_ID, tempFileURL: '', status: -403003 }] };
      },
      async callFunction() {
        return { result: { ok: true, fileList: [] } };
      }
    }
  };

  const roomSessionPath = require.resolve('../../modules/room-session/index');
  const pagePath = require.resolve('../../pages/main-pages/aaa/index');
  const previousRoomSession = require.cache[roomSessionPath];
  require.cache[roomSessionPath] = {
    id: roomSessionPath,
    filename: roomSessionPath,
    loaded: true,
    exports: {
      async getCurrentRoomPageSnapshot() { return { ok: false }; },
      async getRoomPageSnapshot() { return { ok: false }; },
      async dispatchRoomCommand() { return { ok: true }; }
    }
  };
  let definition = null;
  global.Page = (pageDefinition) => { definition = pageDefinition; };
  delete require.cache[pagePath];
  require(pagePath);
  if (previousRoomSession) require.cache[roomSessionPath] = previousRoomSession;
  else delete require.cache[roomSessionPath];

  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) { Object.assign(this.data, patch); }
  };
  page._restoreUserProfile();
  assert.equal(page.data.userAvatarUrl.startsWith('cloud://'), false);
  assert.equal(page.data.userAvatarUrl, DEFAULT_AVATAR);
});
