'use strict';

/**
 * 流程步骤 / legacy currentPage → 路由描述
 * 第一阶段仍消费 currentPage；后续改为 workflow.step。
 */

const PAGE_TO_ROUTE = {
  addplayer: {
    path: '/pages/main-pages/addPlayer/index',
    mode: 'redirect'
  },
  brainstormmode: {
    path: '/pages/main-pages/brainstormMode/index',
    mode: 'redirect'
  },
  modeindex: {
    path: '/pages/main-pages/modeIndex/index',
    mode: 'redirect'
  },
  selectbg: {
    path: '/pages/main-pages/selectBG/index',
    mode: 'navigate'
  },
  confirmbg: {
    path: '/pages/main-pages/partnerMode/confirmBG/index',
    mode: 'redirect'
  },
  selectplayer: {
    path: '/pages/main-pages/selectPlayer/index',
    mode: 'redirect'
  },
  confirmfirstplayer: {
    path: '/pages/main-pages/partnerMode/confirmFirstPlayer/index',
    mode: 'redirect'
  },
  submitproblem: {
    path: '/pages/main-pages/submitProblem/index',
    mode: 'redirect'
  },
  selectproblem: {
    path: '/pages/main-pages/selectProblem/index',
    mode: 'redirect'
  },
  gamepage: {
    path: '/pages/main-pages/partnerMode/gamepage/index',
    mode: 'redirect'
  },
  statement: {
    path: '/pages/main-pages/partnerMode/gamepage/index',
    mode: 'redirect'
  },
  closingstatement: {
    path: '/pages/main-pages/partnerMode/closingStatement/index',
    mode: 'redirect'
  },
  closingend: {
    path: '/pages/main-pages/partnerMode/closingEnd/index',
    mode: 'redirect'
  }
};

function projectRoute({ workflow, mode, actorRole, legacyPage }) {
  const pageKey = String(
    (workflow && workflow.step) || legacyPage || ''
  ).toLowerCase();

  const base = PAGE_TO_ROUTE[pageKey] || null;
  if (!base) {
    return {
      pageKey,
      path: null,
      mode: 'none',
      actorRole: actorRole || 'PLAYER',
      reason: 'UNKNOWN_PAGE'
    };
  }

  return {
    pageKey,
    path: base.path,
    mode: base.mode,
    actorRole: actorRole || 'PLAYER',
    gameMode: mode || null,
    reason: null
  };
}

/**
 * 导航协调：按 revision 串行，避免旧状态回跳
 */
function createNavigationCoordinator(options) {
  const openUrl = options && options.openUrl;
  let lastRevision = 0;
  let inFlight = false;
  let pending = null;

  async function reconcile(routeDescriptor, revision) {
    const rev = revision != null ? Number(revision) : 0;
    if (rev < lastRevision) {
      return { ok: false, skipped: true, reason: 'STALE_REVISION' };
    }
    if (!routeDescriptor || !routeDescriptor.path || routeDescriptor.mode === 'none') {
      return { ok: false, skipped: true, reason: 'NO_ROUTE' };
    }
    if (typeof openUrl !== 'function') {
      return { ok: false, skipped: true, reason: 'NO_OPENER' };
    }

    if (inFlight) {
      pending = { routeDescriptor, revision: rev };
      return { ok: false, skipped: true, reason: 'IN_FLIGHT' };
    }

    inFlight = true;
    try {
      lastRevision = rev;
      await Promise.resolve(openUrl(routeDescriptor));
      return { ok: true };
    } finally {
      inFlight = false;
      if (pending) {
        const next = pending;
        pending = null;
        if (next.revision >= lastRevision) {
          reconcile(next.routeDescriptor, next.revision);
        }
      }
    }
  }

  return {
    reconcile,
    getLastRevision() {
      return lastRevision;
    }
  };
}

module.exports = {
  PAGE_TO_ROUTE,
  projectRoute,
  createNavigationCoordinator
};
