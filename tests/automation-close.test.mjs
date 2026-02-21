import assert from "node:assert/strict";

let onChangedListener = null;
let currentTabs = [];
const tabsById = new Map();
const removedTabs = [];
const downloadCalls = [];
let nextDownloadId = 1;

const storage = {
  sync: {},
  local: {},
  session: {}
};

function resetState() {
  currentTabs = [];
  tabsById.clear();
  removedTabs.length = 0;
  downloadCalls.length = 0;
  nextDownloadId = 1;
  storage.sync = {};
  storage.local = {};
  storage.session = {};
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
      addListener: (fn) => { onChangedListener = fn; }
    },
    download: async (opts) => {
      downloadCalls.push(opts);
      return nextDownloadId++;
    },
    search: async ({ id }) => [{ id, fileSize: 1024, bytesReceived: 1024 }],
    cancel: async () => {},
    removeFile: async () => {},
    erase: async () => {}
  },
  tabs: {
    get: async (tabId) => tabsById.get(tabId) || null,
    remove: (tabId, cb) => {
      removedTabs.push(tabId);
      if (typeof cb === "function") cb();
    },
    query: async () => currentTabs,
    create: async () => ({ id: 999, url: "chrome://newtab/", windowId: 1 })
  },
  permissions: {
    contains: (_query, cb) => cb(false)
  },
  runtime: {
    lastError: null
  },
  scripting: {
    executeScript: async () => [{ result: null }]
  },
  extension: {
    isAllowedFileSchemeAccess: (cb) => cb(false)
  }
};

const downloadsState = await import("../src/downloadsState.js");
const { setDownloadTabMapping, downloadIdToMeta } = downloadsState;
const { runDownload } = await import("../src/downloadOrchestrator.js");

// 1) Close-on-start uses tabUrl as the guard (not download URL)
{
  resetState();
  storage.sync = { closeTabAfterDownload: false, keepWindowOpenOnLastTabClose: false };
  const tabUrl = "https://commons.wikimedia.org/wiki/File:Pluto_and_its_satellites_(2005).jpg";
  const downloadUrl = "https://upload.wikimedia.org/wikipedia/commons/d/d6/Pluto_and_its_satellites_%282005%29.jpg";
  const tab = { id: 1, url: tabUrl, windowId: 1 };
  tabsById.set(1, tab);
  await setDownloadTabMapping(10, 1, tabUrl, downloadUrl, true);
  await onChangedListener({ id: 10, state: { current: "in_progress" } });
  assert.deepEqual(removedTabs, [1]);
}

// 2) Duplicate tabs are skipped but still closed when autoCloseOnStart is enabled
{
  resetState();
  storage.sync = {
    autoCloseOnStart: true,
    closeTabAfterDownload: false,
    keepWindowOpenOnLastTabClose: false,
    strictSingleDetection: false,
    filtersEnabled: false
  };
  const url = "https://example.com/dup.jpg";
  const tab1 = { id: 1, url, active: true, index: 0, windowId: 1 };
  const tab2 = { id: 2, url, active: false, index: 1, windowId: 1 };
  currentTabs = [tab1, tab2];
  tabsById.set(1, tab1);
  tabsById.set(2, tab2);

  await runDownload({ mode: "currentWindow" });
  assert.deepEqual(removedTabs, [2]);
}

console.log("automation-close.test.mjs passed");
