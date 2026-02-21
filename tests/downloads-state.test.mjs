import assert from "node:assert/strict";

let onChangedListener = null;
const tabsById = new Map();
const removedTabs = [];
const cancelCalls = [];
const removeFileCalls = [];
const eraseCalls = [];
const searchResults = new Map();

const storage = {
  sync: {},
  local: {},
  session: {}
};

function resetState(downloadsState) {
  tabsById.clear();
  removedTabs.length = 0;
  cancelCalls.length = 0;
  removeFileCalls.length = 0;
  eraseCalls.length = 0;
  searchResults.clear();
  storage.sync = {};
  storage.local = {};
  storage.session = {};
  downloadsState.downloadIdToMeta.clear();
  downloadsState.pendingSizeConstraints.clear();
}

function getFromStore(area, defaults) {
  const base = (defaults && typeof defaults === "object") ? defaults : {};
  const data = storage[area] || {};
  return { ...base, ...data };
}

globalThis.chrome = {
  storage: {
    sync: {
      get: (defaults, cb) => {
        const data = getFromStore("sync", defaults);
        if (typeof cb === "function") return cb(data);
        return Promise.resolve(data);
      },
      set: async (obj) => {
        storage.sync = { ...(storage.sync || {}), ...(obj || {}) };
      }
    },
    local: {
      get: async (defaults) => getFromStore("local", defaults),
      set: async (obj) => { storage.local = { ...(storage.local || {}), ...(obj || {}) }; }
    },
    session: {
      get: async (defaults) => getFromStore("session", defaults),
      set: async (obj) => { storage.session = { ...(storage.session || {}), ...(obj || {}) }; }
    }
  },
  downloads: {
    onChanged: {
      addListener: (fn) => {
        onChangedListener = fn;
        globalThis.__dmtOnChangedListener = fn;
      }
    },
    search: async ({ id }) => searchResults.get(id) || [],
    cancel: async (id) => { cancelCalls.push(id); },
    removeFile: async (id) => { removeFileCalls.push(id); },
    erase: async (obj) => { eraseCalls.push(obj); }
  },
  tabs: {
    get: async (tabId) => tabsById.get(tabId) || null,
    remove: (tabId, cb) => {
      removedTabs.push(tabId);
      if (typeof cb === "function") cb();
    },
    query: async () => [],
    create: async () => ({ id: 999, url: "chrome://newtab/", windowId: 1 })
  },
  runtime: {
    lastError: null
  },
  permissions: {
    contains: (_query, cb) => cb(false)
  },
  extension: {
    isAllowedFileSchemeAccess: (cb) => cb(false)
  }
};

const downloadsState = await import("../src/downloadsState.js");
const { setDownloadTabMapping, setPendingSizeConstraint } = downloadsState;
const tasksState = await import("../src/tasksState.js");
const { upsertTask, updateTask, getTasks } = tasksState;

// 1) Interrupted downloads mark task failed and clear state
{
  resetState(downloadsState);
  const task = await upsertTask({ tabId: 1, url: "https://example.com/a.jpg", kind: "manual" });
  await updateTask(task.id, { downloadId: 1, status: "started" });
  await setDownloadTabMapping(1, 1, "https://example.com/a.jpg", "https://example.com/a.jpg", false);
  await setPendingSizeConstraint(1, { minBytes: 0, maxBytes: 1000 });

  const listener = onChangedListener || globalThis.__dmtOnChangedListener;
  await listener({ id: 1, state: { current: "interrupted" } });

  const tasks = await getTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "failed");
  assert.equal(tasks[0].lastError, "interrupted");
  assert.equal(downloadsState.downloadIdToMeta.has(1), false);
  assert.equal(downloadsState.pendingSizeConstraints.has(1), false);
}

// 2) Close-on-start closes when guard matches and flips closeOnStart
{
  resetState(downloadsState);
  storage.sync = { closeTabAfterDownload: false, keepWindowOpenOnLastTabClose: false };
  const tab = { id: 2, url: "https://example.com/file.jpg", windowId: 1 };
  tabsById.set(2, tab);
  await setDownloadTabMapping(2, 2, tab.url, tab.url, true);

  const listener = onChangedListener || globalThis.__dmtOnChangedListener;
  await listener({ id: 2, state: { current: "in_progress" } });

  assert.deepEqual(removedTabs, [2]);
  assert.equal(downloadsState.downloadIdToMeta.get(2).closeOnStart, false);
}

// 3) Close-on-start guard mismatch skips closing and clears closeOnStart
{
  resetState(downloadsState);
  storage.sync = { closeTabAfterDownload: false, keepWindowOpenOnLastTabClose: false };
  const tab = { id: 3, url: "https://example.com/other.jpg", windowId: 1 };
  tabsById.set(3, tab);
  await setDownloadTabMapping(3, 3, "https://example.com/file.jpg", "https://example.com/file.jpg", true);

  const listener = onChangedListener || globalThis.__dmtOnChangedListener;
  await listener({ id: 3, state: { current: "in_progress" } });

  assert.deepEqual(removedTabs, []);
  assert.equal(downloadsState.downloadIdToMeta.get(3).closeOnStart, false);
}

// 4) Complete download closes tab and marks task completed
{
  resetState(downloadsState);
  storage.sync = { closeTabAfterDownload: true, keepWindowOpenOnLastTabClose: false };
  const tab = { id: 4, url: "https://example.com/done.jpg", windowId: 1 };
  tabsById.set(4, tab);
  const task = await upsertTask({ tabId: 4, url: tab.url, kind: "manual" });
  await updateTask(task.id, { downloadId: 4, status: "started" });
  await setDownloadTabMapping(4, 4, tab.url, tab.url, false);

  const listener = onChangedListener || globalThis.__dmtOnChangedListener;
  await listener({ id: 4, state: { current: "complete" } });

  const tasks = await getTasks();
  assert.equal(tasks[0].status, "completed");
  assert.deepEqual(removedTabs, [4]);
  assert.equal(downloadsState.downloadIdToMeta.has(4), false);
}

// 5) Size limit exceeded cancels and removes task
{
  resetState(downloadsState);
  const task = await upsertTask({ tabId: 5, url: "https://example.com/big.jpg", kind: "manual" });
  await updateTask(task.id, { downloadId: 5, status: "started" });
  await setPendingSizeConstraint(5, { minBytes: 0, maxBytes: 100 });
  await setDownloadTabMapping(5, 5, "https://example.com/big.jpg", "https://example.com/big.jpg", false);

  const listener = onChangedListener || globalThis.__dmtOnChangedListener;
  await listener({ id: 5, bytesReceived: { current: 101 } });

  const tasks = await getTasks();
  assert.equal(tasks.length, 0);
  assert.deepEqual(cancelCalls, [5]);
  assert.equal(downloadsState.pendingSizeConstraints.has(5), false);
  assert.equal(downloadsState.downloadIdToMeta.has(5), false);
}

console.log("downloads-state.test.mjs passed");
