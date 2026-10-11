'use strict';

// 这里只管理本地屏幕的可见性和生命周期，不保存或推断房间业务状态。
const { NAVIGATION_TIMEOUT_MS: MOUNT_TIMEOUT_MS } = require('./physicalNavigation');

function parseUrl(url) {
  const [path, query = ''] = String(url || '').split('?');
  const params = {};
  query.split('&').filter(Boolean).forEach((item) => {
    const separator = item.indexOf('=');
    const key = separator < 0 ? item : item.slice(0, separator);
    const value = separator < 0 ? '' : item.slice(separator + 1);
    params[decodeURIComponent(key)] = decodeURIComponent(value);
  });
  return { path: `/${path.replace(/^\//, '')}`, params };
}

function updateData(data, patch) {
  Object.entries(patch).forEach(([path, value]) => {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = data;
    keys.slice(0, -1).forEach((key, index) => {
      const previous = target[key];
      target[key] = previous == null ? (/^\d+$/.test(keys[index + 1]) ? [] : {})
        : (Array.isArray(previous) ? previous.slice() : { ...previous });
      target = target[key];
    });
    target[keys[keys.length - 1]] = value;
  });
}

function createChannel(events = {}) {
  const listeners = new Map(Object.entries(events).map(([name, handler]) => [name, [handler]]));
  const pending = new Map();
  return {
    on(name, handler) {
      const handlers = listeners.get(name) || [];
      handlers.push(handler);
      listeners.set(name, handlers);
      const queued = pending.get(name) || [];
      pending.delete(name);
      queued.forEach((value) => handler(value));
    },
    emit(name, value) {
      const handlers = listeners.get(name);
      if (handlers) handlers.forEach((handler) => handler(value));
      else pending.set(name, [...(pending.get(name) || []), value]);
    }
  };
}

function withLocalScreens(definition, screens, options = {}) {
  const lifecycle = {
    load: definition.onLoad, show: definition.onShow,
    hide: definition.onHide, unload: definition.onUnload
  };
  definition.data = { ...definition.data, localScreenActive: false, localScreens: [] };
  definition.onLoad = function onLoad(params) {
    this._localScreens = createHost(this, screens, lifecycle, options);
    this._physicalEntryOptions = params || {};
    return lifecycle.load && lifecycle.load.call(this, params);
  };
  definition.onShow = function onShow() {
    if (this._localScreens) return this._localScreens.show();
    return lifecycle.show && lifecycle.show.call(this);
  };
  definition.onHide = function onHide() {
    if (this._localScreens) return this._localScreens.hide();
    return lifecycle.hide && lifecycle.hide.call(this);
  };
  definition.onUnload = function onUnload() {
    if (this._localScreens) this._localScreens.dispose();
    return lifecycle.unload && lifecycle.unload.call(this);
  };
  definition.onLocalScreenReady = function onLocalScreenReady(event) {
    const { token } = event.detail;
    const scope = this.selectComponent(`#local-screen-${token}`);
    if (this._localScreens && scope) this._localScreens.ready(token, scope);
  };
  definition.onLocalScreenIntent = function onLocalScreenIntent(event) {
    const { token, name, event: intent } = event.detail;
    if (this._localScreens) return this._localScreens.intent(token, name, intent);
  };
  return definition;
}

function createHost(owner, screens, lifecycle, options) {
  let frames = [];
  let nextToken = 0;
  let visible = false;
  let alive = true;
  let unsubscribe = null;
  const currentFrame = () => frames[frames.length - 1];
  const notify = (controller, method) => {
    if (controller && typeof controller[method] === 'function') controller[method]();
  };
  const publish = (callback) => owner.setData({
    localScreenActive: frames.length > 0,
    localScreens: frames.map((frame, index) => ({
      name: frame.config.name, token: frame.token,
      visible: index === frames.length - 1, model: { ...frame.controller.data }
    }))
  }, callback);
  function hideFrame(frame) {
    if (!frame) return;
    // 作用域对象即使随后复用，旧可见周期的异步测量也不能重新变为有效。
    frame.layoutRevision += 1;
    if (!frame.shown) return;
    frame.shown = false;
    notify(frame.controller, 'onHide');
  }
  function removeFrame(frame) {
    hideFrame(frame);
    clearTimeout(frame.timer);
    frame.controller._localScreenDisposed = true;
    frame.scope = null;
    notify(frame.controller, 'onUnload');
    if (frame.finish) frame.finish({ ok: false, reason: 'LOCAL_SCREEN_CLOSED' });
  }
  function stopWatching() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
  }
  function resumeRoot() {
    if (alive && visible && frames.length === 0 && lifecycle.show) lifecycle.show.call(owner);
  }
  const host = {
    owner,
    current: () => currentFrame() && currentFrame().controller,
    owns: (controller) => alive && frames.some((frame) => frame.controller === controller),
    captureLayoutGuard(controller) {
      const frame = currentFrame();
      if (!alive || !visible || !frame || frame.controller !== controller || !frame.scope) return () => false;
      const { scope, layoutRevision } = frame;
      return () => alive && visible && currentFrame() === frame && !controller._localScreenDisposed
        && frame.scope === scope && frame.layoutRevision === layoutRevision;
    },
    pages: () => [owner, ...frames.map((frame) => frame.controller)],
    accepts: (url) => !!screens[parseUrl(url).path],
    async open(url, navigationOptions = {}, replace = false) {
      if (!alive) return { ok: false, reason: 'LOCAL_SCREEN_GONE' };
      const { path, params } = parseUrl(url);
      const config = screens[path];
      if (!config) return { ok: false, reason: 'UNKNOWN_LOCAL_SCREEN' };
      const controller = config.create();
      const previous = currentFrame();
      if (previous) {
        hideFrame(previous);
        // 被覆盖的展示组件会销毁；返回时须等待新组件 ready，不能复用旧查询作用域。
        previous.scope = null;
      }
      else if (visible && lifecycle.hide) lifecycle.hide.call(owner);
      if (replace && previous) { frames.pop(); removeFrame(previous); }
      controller.data = JSON.parse(JSON.stringify(controller.data || {}));
      controller.route = path.slice(1);
      controller.options = params;
      controller._localScreenHost = host;
      const channel = createChannel(navigationOptions.events);
      controller.getOpenerEventChannel = () => channel;
      controller.getLocalScreenPages = host.pages;
      const frame = { token: ++nextToken, config, controller, channel, params,
        loaded: false, shown: false, layoutRevision: 0 };
      controller.createSelectorQuery = () => frame.scope.createSelectorQuery();
      controller.setData = (patch, callback) => {
        if (!alive || controller._localScreenDisposed) return;
        updateData(controller.data, patch);
        if (currentFrame() === frame) {
          const index = frames.length - 1;
          const renderPatch = {};
          Object.entries(patch).forEach(([key, value]) => { renderPatch[`localScreens[${index}].model.${key}`] = value; });
          owner.setData(renderPatch, callback);
        }
        else if (callback) callback();
      };
      frames.push(frame);
      const opened = new Promise((resolve) => {
        frame.finish = (result) => { frame.finish = null; clearTimeout(frame.timer); resolve(result); };
        frame.timer = setTimeout(() => {
          if (!frame.finish) return;
          frame.finish({ ok: false, reason: 'LOCAL_SCREEN_MOUNT_TIMEOUT' });
          host.close(controller);
        }, Number(navigationOptions.navigationTimeoutMs) > 0 ? Number(navigationOptions.navigationTimeoutMs) : MOUNT_TIMEOUT_MS);
      });
      publish();
      if (!unsubscribe && typeof options.subscribe === 'function') {
        const subscription = options.subscribe(owner, host);
        if (!alive || !frames.length) { if (subscription) subscription(); }
        else unsubscribe = subscription;
      }
      return opened;
    },
    ready(token, scope) {
      const frame = currentFrame();
      if (!alive || !frame || frame.token !== token) return;
      if (frame.scope !== scope) frame.layoutRevision += 1;
      frame.scope = scope;
      try {
        if (!frame.loaded) {
          frame.loaded = true;
          if (frame.controller.onLoad) frame.controller.onLoad(frame.params);
        }
        if (currentFrame() !== frame || !alive) return;
        if (visible && !frame.shown) {
          frame.shown = true;
          notify(frame.controller, 'onShow');
        }
        if (frame.finish) frame.finish({ ok: true, result: { eventChannel: frame.channel, local: true } });
      } catch (error) {
        if (frame.finish) frame.finish({ ok: false, error });
        host.close(frame.controller);
      }
    },
    intent(token, name, event) {
      const frame = currentFrame();
      if (!alive || !visible || !frame || frame.token !== token || !frame.shown) return;
      if (!(frame.config.intents || []).includes(name)) return;
      if (typeof frame.controller[name] !== 'function') return;
      return frame.controller[name](event);
    },
    async close(controller) {
      const frame = currentFrame();
      // 迟到回调只能关闭它自己的屏幕，不得弹出后续打开的新屏幕。
      if (!alive || !frame || frame.controller !== controller) return { ok: false, reason: 'LOCAL_SCREEN_GONE' };
      frames.pop();
      removeFrame(frame);
      if (!frames.length) stopWatching();
      publish(resumeRoot);
      return { ok: true, result: { local: true } };
    },
    async reconcileAuthority(route, roomId) {
      if (!alive || !frames.length) return;
      const sameRoom = !owner.data.roomId || !roomId || owner.data.roomId === roomId;
      if (sameRoom && frames.every((frame) => frame.config.routes.includes(route.name))) return;
      const removed = frames; frames = [];
      // 先清空所有权，再卸载，避免卸载/迟到回调再次关闭正在恢复的 owner。
      removed.slice().reverse().forEach(removeFrame);
      stopWatching();
      await new Promise((resolve) => publish(() => { resumeRoot(); resolve(); }));
    },
    show() {
      if (!alive || visible) return;
      visible = true;
      const frame = currentFrame();
      if (frame && frame.loaded && frame.scope) {
        frame.shown = true; notify(frame.controller, 'onShow');
      } else if (!frame) resumeRoot();
    },
    hide() {
      if (!alive || !visible) return;
      visible = false;
      const frame = currentFrame();
      if (frame) hideFrame(frame);
      else if (lifecycle.hide) lifecycle.hide.call(owner);
    },
    dispose() {
      if (!alive) return;
      alive = false; visible = false;
      const removed = frames; frames = [];
      stopWatching();
      removed.slice().reverse().forEach(removeFrame);
      publish();
    }
  };
  return host;
}

function activeHost(page) {
  if (page && page._localScreenDisposed) return null;
  if (page) return page._localScreenHost || page._localScreens || null;
  const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
  return pages.length && pages[pages.length - 1]._localScreens || null;
}

// 在排队时捕获，而不是在回调里重新读取最新 scope；查询和结果安装两端都需校验。
function captureLayoutGuard(page) {
  if (page._localScreenHost) return page._localScreenHost.captureLayoutGuard(page);
  return () => page._pageAlive !== false && page._pageVisible !== false;
}

function tryLocalNavigation(method, options, page) {
  if (page && page._localScreenDisposed) return Promise.resolve({ ok: false, reason: 'LOCAL_SCREEN_GONE' });
  const host = activeHost(page);
  if (!host) return null;
  if (page && page._localScreenHost && host.current() !== page) return Promise.resolve({ ok: false, reason: 'LOCAL_SCREEN_GONE' });
  let request;
  if (method === 'navigateBack' && host.current()) request = host.close(page && page._localScreenHost ? page : host.current());
  else if (['navigateTo', 'redirectTo'].includes(method) && host.accepts(options.url)) {
    request = host.open(options.url, options, method === 'redirectTo');
  } else return null;
  return request.then((result) => {
    if (result.ok && options.success) options.success(result.result);
    if (!result.ok && options.fail) options.fail(result.error || result);
    if (options.complete) options.complete(result.result || result);
    return result;
  });
}

module.exports = { withLocalScreens, tryLocalNavigation, activeHost, captureLayoutGuard };
