import assert from "node:assert/strict";
import { createStorageFixture, createDownloadsStub, createTabsStub, createChromeBase, ref } from "./helpers/chrome-stubs.mjs";

const onChangedListener = ref(null);
let currentTabs = [];
const tabsById = new Map();
const removedTabs = [];
const downloadCalls = [];
const nextDownloadId = ref(1);
const searchResults = new Map();
let downloadIdToMeta = null;
let pendingSizeConstraints = null;
const storageFixture = createStorageFixture();
const storage = storageFixture.storage;

function resetState() {
  currentTabs = [];
  tabsById.clear();
  removedTabs.length = 0;
  downloadCalls.length = 0;
  searchResults.clear();
  nextDownloadId.current = 1;
  storage.sync = {};
  storage.local = {};
  storage.session = {};
  if (downloadIdToMeta) downloadIdToMeta.clear();
  if (pendingSizeConstraints) pendingSizeConstraints.clear();
}

const downloads = createDownloadsStub({
  onChangedListenerRef: onChangedListener,
  downloadCalls,
  nextDownloadIdRef: nextDownloadId,
  searchResults
});
const tabs = createTabsStub({
  get: async (tabId) => tabsById.get(tabId) || null,
  remove: (tabId, cb) => {
    removedTabs.push(tabId);
    if (typeof cb === "function") cb();
  },
  query: async () => currentTabs
});
globalThis.chrome = createChromeBase({ storageFixture, downloads, tabs });

const downloadsState = await import("../src/downloadsState.js");
const { setDownloadTabMapping, setPendingSizeConstraint } = downloadsState;
({ downloadIdToMeta, pendingSizeConstraints } = downloadsState);
const tasksState = await import("../src/tasksState.js");
const { upsertTask, updateTask, getTasks } = tasksState;
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
  const listener = onChangedListener.current || globalThis.__dmtOnChangedListener;
  await listener({ id: 10, state: { current: "in_progress" } });
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

// 3) Post-download size limits should remove the task (filtered)
{
  resetState();
  storage.sync = { closeTabAfterDownload: false, keepWindowOpenOnLastTabClose: false };
  const task = await upsertTask({ tabId: 1, url: "https://example.com/file.jpg", kind: "manual" });
  await updateTask(task.id, { downloadId: 42, status: "started" });
  await setPendingSizeConstraint(42, { minBytes: 0, maxBytes: 100 });
  searchResults.set(42, [{ id: 42, fileSize: 1024, bytesReceived: 1024 }]);
  const before = await getTasks();
  assert.equal(before.length, 1);

  const listener = onChangedListener.current || globalThis.__dmtOnChangedListener;
  await listener({ id: 42, state: { current: "complete" } });

  const after = await getTasks();
  assert.equal(after.length, 0);
}

console.log("automation-close.test.mjs passed");
