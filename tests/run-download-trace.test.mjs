import assert from "node:assert/strict";
import { runDownload } from "../src/downloadOrchestrator.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { createStorageFixture, createDownloadsStub, createTabsStub, createChromeBase, ref } from "./helpers/chrome-stubs.mjs";

const downloadCalls = [];
const nextDownloadId = ref(1);
const onChangedListener = ref(null);
const storageFixture = createStorageFixture();
const storage = storageFixture.storage;

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

const downloads = createDownloadsStub({
  onChangedListenerRef: onChangedListener,
  downloadCalls,
  nextDownloadIdRef: nextDownloadId
});
const tabsApi = createTabsStub({
  query: async () => tabs,
  get: async (tabId) => tabs.find(t => t.id === tabId) || null
});
globalThis.chrome = createChromeBase({ storageFixture, downloads, tabs: tabsApi });

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
