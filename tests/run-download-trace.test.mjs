import assert from "node:assert/strict";
import { runDownload } from "../src/downloadOrchestrator.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";

const downloadCalls = [];
let nextDownloadId = 1;
let onChangedListener = null;

const storage = {
  sync: {},
  local: {},
  session: {}
};

function getFromStore(area, defaults) {
  const base = (defaults && typeof defaults === "object") ? defaults : {};
  const data = storage[area] || {};
  return { ...base, ...data };
}

globalThis.fetch = async (url) => {
  const isSmall = String(url).includes("small");
  return {
    ok: true,
    headers: {
      get: (name) => {
        if (String(name).toLowerCase() === "content-length") {
          return isSmall ? "50" : "1000";
        }
        return null;
      }
    }
  };
};

const tabs = [
  { id: 1, url: "https://blocked.com/a.jpg", windowId: 1 },
  { id: 2, url: "https://example.com/dup.jpg", windowId: 1 },
  { id: 3, url: "https://example.com/dup.jpg", windowId: 1 },
  { id: 4, url: "https://example.com/small.jpg", windowId: 1 }
];

globalThis.chrome = {
  storage: {
    sync: {
      get: (defaults, cb) => {
        const data = getFromStore("sync", defaults);
        if (typeof cb === "function") return cb(data);
        return Promise.resolve(data);
      },
      set: async (obj) => { storage.sync = { ...(storage.sync || {}), ...(obj || {}) }; }
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
    onChanged: { addListener: (fn) => { onChangedListener = fn; } },
    download: async (opts) => {
      downloadCalls.push(opts);
      return nextDownloadId++;
    },
    search: async () => [],
    cancel: async () => {},
    removeFile: async () => {},
    erase: async () => {}
  },
  tabs: {
    query: async () => tabs,
    get: async (tabId) => tabs.find(t => t.id === tabId) || null,
    remove: (_tabId, cb) => { if (typeof cb === "function") cb(); },
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

storage.sync = {
  ...DEFAULT_SETTINGS,
  filtersEnabled: true,
  autoCloseOnStart: false,
  closeTabAfterDownload: false,
  filters: {
    ...DEFAULT_SETTINGS.filters,
    blockedDomains: ["blocked.com"],
    minBytes: 100
  }
};

await runDownload({ mode: "currentWindow" });

const trace = storage.local.dmtLastRunTrace;
assert.equal(Boolean(trace), true);

const byTabId = new Map(trace.entries.map(e => [e.tabId, e]));
assert.equal(byTabId.get(1).decision, "filtered");
assert.equal(byTabId.get(1).reason, "filtered");

const dupEntry2 = byTabId.get(2);
const dupEntry3 = byTabId.get(3);
const dupReasons = [dupEntry2.reason, dupEntry3.reason].sort();
const dupDecisions = [dupEntry2.decision, dupEntry3.decision].sort();
assert.deepEqual(dupReasons, ["duplicate", "started"]);
assert.deepEqual(dupDecisions, ["download", "skipped"]);

assert.equal(byTabId.get(4).decision, "filtered");
assert.equal(byTabId.get(4).reason, "size-filter");

console.log("run-download-trace.test.mjs passed");
