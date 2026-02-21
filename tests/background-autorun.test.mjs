import assert from "node:assert/strict";
import { createStorageFixture, createDownloadsStub, createTabsStub, createChromeBase, createAlarmsStub, ref } from "./helpers/chrome-stubs.mjs";
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
    downloadsChanged: [],
    alarms: []
  };
  const calls = {
    downloads: [],
    tabsCreate: [],
    tabsRemove: [],
    contextMenusCreate: 0,
    alarmsCreate: [],
    alarmsClear: []
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

  const alarms = createAlarmsStub({
    onAlarmListeners: listeners.alarms,
    createCalls: calls.alarmsCreate,
    clearCalls: calls.alarmsClear
  });

  const chromeBase = createChromeBase({
    storageFixture,
    storageOnChangedListeners: listeners.storageChanged,
    downloads,
    tabs: tabsApi,
    alarms,
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

// 2) probe failure removes auto task (no pending)
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
  assert.equal(tasks.length, 0);
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

// 4) missing site access removes auto task (no-site-access skip)
{
  const env = createChromeStub({
    sync: { autoRunOnNewTabs: true, autoRunTiming: "start", autoCloseOnStart: false, strictSingleDetection: true },
    permissionsOk: false,
    executeScriptThrows: false
  });
  await resetTasksStorage();
  resetDownloadsState(downloadsState);
  await importBackground("auto-no-access");
  await tick();

  const tab = { id: 5, url: "https://example.com/noaccess", status: "loading", windowId: 1 };
  env.tabsById.set(5, tab);
  await withMutedConsole(async () => {
    for (const fn of env.listeners.tabsUpdated) {
      await fn(5, { status: "loading" }, tab);
    }
  });

  const tasks = await tasksState.getTasks();
  assert.equal(env.calls.downloads.length, 0);
  assert.equal(tasks.length, 0);
}

// 5) autoRunTiming=complete does not create pending task on loading
{
  const env = createChromeStub({
    sync: { autoRunOnNewTabs: true, autoRunTiming: "complete", autoCloseOnStart: false, strictSingleDetection: false }
  });
  await resetTasksStorage();
  resetDownloadsState(downloadsState);
  await importBackground("auto-complete-loading");
  await tick();

  const tab = { id: 6, url: "https://example.com/page", status: "loading", windowId: 1 };
  env.tabsById.set(6, tab);
  await withMutedConsole(async () => {
    for (const fn of env.listeners.tabsUpdated) {
      await fn(6, { status: "loading" }, tab);
    }
  });

  const tasks = await tasksState.getTasks();
  assert.equal(tasks.length, 0);
}

// 6) manual start runs pending task on existing tab
{
  const env = createChromeStub({
    sync: { autoRunOnNewTabs: false, autoRunTiming: "start", autoCloseOnStart: false, strictSingleDetection: false }
  });
  await resetTasksStorage();
  resetDownloadsState(downloadsState);
  await importBackground("manual-start");
  await tick();

  const tab = { id: 8, url: "https://example.com/manual.jpg", status: "complete", windowId: 1 };
  env.tabsById.set(8, tab);
  const task = await tasksState.upsertTask({ tabId: 8, url: tab.url, kind: "manual" });
  await tasksState.updateTask(task.id, { status: "pending", lastError: "" });

  for (const fn of env.listeners.runtimeMessage) {
    fn({ type: "dmt_start_task", taskId: task.id }, null, () => {});
  }
  await tick();

  const tasks = await tasksState.getTasks();
  assert.equal(env.calls.downloads.length, 1);
  assert.equal(tasks[0].downloadId > 0, true);
}

// 7) alarm processing runs pending auto tasks
{
  const env = createChromeStub({
    sync: { autoRunOnNewTabs: true, autoRunTiming: "start", autoCloseOnStart: false, strictSingleDetection: false }
  });
  await resetTasksStorage();
  resetDownloadsState(downloadsState);
  await importBackground("pending-alarm");
  await tick();

  const tab = { id: 9, url: "https://example.com/alarm.jpg", status: "loading", windowId: 1 };
  env.tabsById.set(9, tab);
  await tasksState.upsertTask({ tabId: 9, url: tab.url, kind: "auto" });

  for (const fn of env.listeners.alarms) {
    await fn({ name: "dmt-pending-tasks" });
  }
  await tick();

  const tasks = await tasksState.getTasks();
  assert.equal(env.calls.downloads.length, 1);
  assert.equal(tasks[0].downloadId > 0, true);
}

console.log("background-autorun.test.mjs passed");
