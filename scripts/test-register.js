'use strict';

const Module = require('module');
const path = require('path');

const root = path.join(__dirname, '..', 'packages');
const map = {
  '@cardboard/room-contracts': path.join(root, 'room-contracts'),
  '@cardboard/room-domain': path.join(root, 'room-domain'),
  '@cardboard/room-application': path.join(root, 'room-application'),
  '@cardboard/room-cloudbase-adapter': path.join(root, 'room-cloudbase-adapter'),
  '@cardboard/room-client': path.join(root, 'room-client')
};

const orig = Module._resolveFilename;
Module._resolveFilename = function resolveWorkspace(request, parent, isMain, options) {
  if (map[request]) {
    return orig.call(this, map[request], parent, isMain, options);
  }
  return orig.call(this, request, parent, isMain, options);
};
