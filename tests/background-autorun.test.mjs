import assert from "node:assert/strict";
import { createStorageFixture, createDownloadsStub, createTabsStub, createChromeBase, ref } from "./helpers/chrome-stubs.mjs";
import { resetTasksStorage } from "./helpers/tasks-helpers.mjs";
import { resetDownloadsState } from "./helpers/downloads-state-helpers.mjs";
import { withMutedConsole } from "./helpers/console-mute.mjs";

const tasksState = await import("../src/tasksState.js");
const downloadsState = await import("../src/downloadsState.js");

function createChromeStub({ sync = {}, permissionsOk = false, executeScriptThrows = false } = {}) {
  const listeners = {
    runtimeInstalled: [],
    runtimeStartup: [],
    runtimeMessage: [],
    tabsUpdated: [],
    tabsRemoved: [],
    storageChanged: [],
    actionClicked: [],
    contextMenuClicked: [],
    downloadsChanged: []
  };
  const calls = {
    downloads: [],
    tabsCreate: [],
    tabsRemove: [],
    contextMenusCreate: 0
  };
  const storageFixture = createStorageFixture({ sync });
  const storage = storageFixture.storage;
  const tabsById = new Map();
  const nextTabId = ref(1000);
  const nextDownloadId = ref(1);

  const downloads = createDownloadsStub({
    downloadCalls: calls.downloads,
    nextDownloadIdRef: nextDownloadId,
    onChangedListenerRef: ref(null)
  });

  const tabsApi = createTabsStub({
    create: async (opts) => {
      const tab = {
        id: nextTabId.current++,
        url: opts.url,
        windowId: opts.windowId || 1,
        status: "loading",
        active: false
      };
      tabsById.set(tab.id, tab);
      calls.tabsCreate.push(tab);
      return tab;
    },
    get: async (tabId) => tabsById.get(tabId) || null,
    query: async () => Array.from(tabsById.values()),
    remove: (tabId, cb) => {
      calls.tabsRemove.push(tabId);
      if (typeof cb === "function") cb();
    }
  });

  const chromeBase = createChromeBase({
    storageFixture,
    storageOnChangedListeners: listeners.storageChanged,
    downloads,
    tabs: tabsApi,
    permissionsOk,
    scriptingExecuteScript: async () => {
      if (executeScriptThrows) throw new Error("probe failed");
      return [{ result: null }];
    }
  });

  globalThis.chrome = {
    ...chromeBase,
    runtime: {
      ...chromeBase.runtime,
      onInstalled: { addListener: (fn) => { listeners.runtimeInstalled.push(fn); } },
      onStartup: { addListener: (fn) => { listeners.runtimeStartup.push(fn); } },
      onMessage: { addListener: (fn) => { listeners.runtimeMessage.push(fn); } },
      openOptionsPage: () => {}
    },
    tabs: {
      ...tabsApi,
      onUpdated: { addListener: (fn) => { listeners.tabsUpdated.push(fn); } },
      onRemoved: { addListener: (fn) => { listeners.tabsRemoved.push(fn); } }
    },
    action: {
      onClicked: { addListener: (fn) => { listeners.actionClicked.push(fn); } }
    },
    contextMenus: {
      removeAll: (cb) => { if (typeof cb === "function") cb(); },
      create: () => { calls.contextMenusCreate += 1; },
      onClicked: { addListener: (fn) => { listeners.contextMenuClicked.push(fn); } }
    }
  };

  return { listeners, calls, storage, tabsById };
}

async function importBackground(tag) {
  const url = new URL("../src/background.js", import.meta.url);
  url.search = `test=${tag}-${Date.now()}`;
  await import(url.href);
}

async function tick() {
  await new Promise(resolve => setTimeout(resolve, 0));
}

// 1) auto-run start triggers download
{
  const env = createChromeStub({
    sync: { autoRunOnNewTabs: true, autoRunTiming: "start", autoCloseOnStart: false, strictSingleDetection: false }
  });
  await resetTasksStorage();
  resetDownloadsState(downloadsState);
  await importBackground("auto-start");
  await tick();

  const tab = { id: 1, url: "https://example.com/file.jpg", status: "loading", windowId: 1 };
  env.tabsById.set(1, tab);
  await withMutedConsole(async () => {
    for (const fn of env.listeners.tabsUpdated) {
      await fn(1, { status: "loading" }, tab);
    }
  });

  const tasks = await tasksState.getTasks();
  assert.equal(env.calls.downloads.length, 1);
  assert.equal(tasks.length, 1);
  assert.equal(typeof tasks[0].downloadId, "number");
}

// 2) auto-run retry on no-download sets pending + no-download
{
  const env = createChromeStub({
    sync: { autoRunOnNewTabs: true, autoRunTiming: "start", autoCloseOnStart: false, strictSingleDetection: true },
    permissionsOk: true,
    executeScriptThrows: true
  });
  await resetTasksStorage();
  resetDownloadsState(downloadsState);
  await importBackground("auto-retry");
  await tick();

  const tab = { id: 2, url: "https://example.com/file.jpg", status: "loading", windowId: 1 };
  env.tabsById.set(2, tab);
  await withMutedConsole(async () => {
    for (const fn of env.listeners.tabsUpdated) {
      await fn(2, { status: "loading" }, tab);
    }
  });

  const tasks = await tasksState.getTasks();
  assert.equal(env.calls.downloads.length, 0);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "pending");
  assert.equal(tasks[0].lastError, "no-download");
}

// 3) manual retry flow starts download on tab complete
{
  const env = createChromeStub({
    sync: { autoRunOnNewTabs: false, autoRunTiming: "start", autoCloseOnStart: false, strictSingleDetection: false }
  });
  await resetTasksStorage();
  resetDownloadsState(downloadsState);
  await importBackground("manual-retry");
  await tick();

  const task = await tasksState.upsertTask({ tabId: 99, url: "https://example.com/retry.jpg", kind: "manual" });
  await tasksState.updateTask(task.id, { status: "failed", lastError: "no-download" });

  for (const fn of env.listeners.runtimeMessage) {
    fn({ type: "dmt_retry_task", taskId: task.id }, null, () => {});
  }
  await tick();

  assert.equal(env.calls.tabsCreate.length, 1);
  const created = env.calls.tabsCreate[0];
  const completeTab = { ...created, status: "complete" };
  env.tabsById.set(created.id, completeTab);
  await withMutedConsole(async () => {
    for (const fn of env.listeners.tabsUpdated) {
      await fn(created.id, { status: "complete" }, completeTab);
    }
  });

  const tasks = await tasksState.getTasks();
  assert.equal(env.calls.downloads.length, 1);
  assert.equal(tasks[0].downloadId > 0, true);
}

console.log("background-autorun.test.mjs passed");
