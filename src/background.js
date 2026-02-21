// Download Media Tabs — MV3 service worker (ES module)
// Now modularized into several focused modules for readability and maintenance.

import { setDefaultContextMenus, installActionClick, installContextMenuClick } from './menus.js';
import { runDownload, runTaskForTab } from './downloadOrchestrator.js';
import { upsertTask, updateTask, getTasks, getTaskById, markTasksForClosedTab, findTaskByTabUrlKind } from './tasksState.js';
import { hasActiveDownloadForTab } from './downloadsState.js';
import './downloadsState.js'; // side-effect: installs downloads onChanged listener
import { isFileSchemeAllowed } from './fileAccess.js';
import { REASONS } from './reasons.js';
import {
  addRuntimeOnInstalledListener,
  addRuntimeOnStartupListener,
  runtimeOpenOptionsPage,
  storageLocalSet,
  storageSyncGet,
  addStorageOnChangedListener,
  addTabsOnRemovedListener,
  addTabsOnUpdatedListener,
  tabsGet,
  tabsCreate,
  addRuntimeOnMessageListener
} from './chromeApi.js';

// Initialize context menus on install/startup
addRuntimeOnInstalledListener((details) => {
  try { setDefaultContextMenus(); } catch {}
  if (details?.reason === 'install') {
    // Mark first-install so the Options page can show a welcome toast
    storageLocalSet({ shouldShowWelcome: true, firstInstallAt: Date.now() });
    // Open the Options page on first install
    runtimeOpenOptionsPage();
  }
});
addRuntimeOnStartupListener(setDefaultContextMenus);

// Wire action and context menu clicks to orchestrator
installActionClick(runDownload);
installContextMenuClick(runDownload);

// Auto-run on new tabs if enabled in settings
let autoRunEnabled = false;
let autoRunLoaded = false; // whether we have read the setting in this SW lifetime
let autoRunTiming = "start";
let autoCloseOnStart = false;
let keepWindowOpenOnLastTabClose = false;
const lastProcessedUrlByTab = new Map();
const manualRetryByTabId = new Map();

async function refreshAutoRunSetting() {
  try {
    const obj = await storageSyncGet({
      autoRunOnNewTabs: false,
      autoRunTiming: "start",
      autoCloseOnStart: false,
      keepWindowOpenOnLastTabClose: false
    });
    autoRunEnabled = !!obj.autoRunOnNewTabs;
    autoRunTiming = (obj.autoRunTiming === "start" || obj.autoRunTiming === "complete") ? obj.autoRunTiming : "start";
    autoCloseOnStart = !!obj.autoCloseOnStart;
    keepWindowOpenOnLastTabClose = !!obj.keepWindowOpenOnLastTabClose;
  } catch {
    autoRunEnabled = false;
    autoRunTiming = "start";
    autoCloseOnStart = false;
    keepWindowOpenOnLastTabClose = false;
  } finally {
    autoRunLoaded = true;
  }
}

async function runAutoTaskForTab(tab, task, phase) {
  if (!tab || !tab.url) return;
  const retryOnComplete = (phase === "start" && autoRunTiming === "start" && !autoCloseOnStart);
  try {
    await runTaskForTab(tab, task.id, { closeOnStart: autoCloseOnStart, retryOnComplete });
  } catch {
    await updateTask(task.id, {
      status: retryOnComplete ? "pending" : "failed",
      lastError: REASONS.NO_DOWNLOAD
    });
  }
}

async function handleAutoRun(tab, phase) {
  if (!autoRunEnabled) return;
  if (!tab || !tab.url) return;
  if (manualRetryByTabId.has(tab.id)) return;
  try {
    const u = new URL(tab.url);
    if (u.protocol === "file:") {
      const allowed = await isFileSchemeAllowed();
      if (!allowed) return;
    } else if (!['http:', 'https:', 'ftp:', 'data:'].includes(u.protocol)) {
      return;
    }
  } catch { return; }

  const existing = await findTaskByTabUrlKind(tab.id, tab.url, "auto");
  const lastError = existing?.lastError || "";

  const prevUrl = lastProcessedUrlByTab.get(tab.id);
  if (prevUrl === tab.url && lastError !== REASONS.NO_DOWNLOAD) return;

  if (phase === "start" && lastError === REASONS.NO_DOWNLOAD) return;

  const shouldRun =
    (autoRunTiming === phase) ||
    (phase === "complete" && lastError === REASONS.NO_DOWNLOAD);

  if (!existing && !shouldRun) return;

  const task = existing || await upsertTask({ tabId: tab.id, url: tab.url, kind: "auto" });
  if (task.status !== "pending") return;
  if (!shouldRun) return;

  lastProcessedUrlByTab.set(tab.id, tab.url);
  await runAutoTaskForTab(tab, task, phase);
}

async function processPendingTasks() {
  if (!autoRunEnabled) return;
  const tasks = await getTasks();
  if (!tasks.length) return;
  const pending = tasks.filter(t => t && t.status === "pending" && t.kind === "auto");
  if (!pending.length) return;
  for (const task of pending) {
    let tab;
    try { tab = await tabsGet(task.tabId); } catch { continue; }
    if (!tab || tab.url !== task.url) continue;
    if (autoRunTiming === "complete" && tab.status !== "complete") continue;
    if (autoRunTiming === "start" && tab.status !== "loading" && tab.status !== "complete") continue;
    if (autoRunTiming === "start" && tab.status === "complete" && task.lastError !== REASONS.NO_DOWNLOAD) {
      continue;
    }
    await runAutoTaskForTab(tab, task, (autoRunTiming === "start" ? "start" : "complete"));
  }
}

// Proactively load setting on service worker start
// (MV3 SW can spin down and restart; this ensures the flag is populated on each load)
try {
  refreshAutoRunSetting().then(processPendingTasks).catch(() => {});
} catch {}

// Initialize setting on startup and install
addRuntimeOnStartupListener(refreshAutoRunSetting);
addRuntimeOnInstalledListener(refreshAutoRunSetting);

// React to settings changes
addStorageOnChangedListener((changes, area) => {
  if (area !== 'sync' || !changes) return;
  if (Object.prototype.hasOwnProperty.call(changes, 'autoRunOnNewTabs')) {
    autoRunEnabled = !!(changes.autoRunOnNewTabs.newValue);
    autoRunLoaded = true;
    if (autoRunEnabled) {
      try { processPendingTasks(); } catch {}
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'autoRunTiming')) {
    autoRunTiming = (changes.autoRunTiming.newValue === "start" || changes.autoRunTiming.newValue === "complete")
      ? changes.autoRunTiming.newValue
      : "complete";
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'autoCloseOnStart')) {
    autoCloseOnStart = !!changes.autoCloseOnStart.newValue;
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'keepWindowOpenOnLastTabClose')) {
    keepWindowOpenOnLastTabClose = !!changes.keepWindowOpenOnLastTabClose.newValue;
  }
});

// Clean up cache when tab is removed
addTabsOnRemovedListener((tabId) => {
  lastProcessedUrlByTab.delete(tabId);
  manualRetryByTabId.delete(tabId);
  try {
    if (!hasActiveDownloadForTab(tabId)) {
      markTasksForClosedTab(tabId);
    }
  } catch {}
});

addTabsOnUpdatedListener(async (tabId, changeInfo, tab) => {
  // Ensure we have loaded the setting at least once in this SW lifetime
  if (!autoRunLoaded) {
    try { await refreshAutoRunSetting(); } catch {}
  }
  if (!autoRunEnabled) return;
  if (!tab || !tab.url) return;
  if (changeInfo.status === 'loading') {
    await handleAutoRun(tab, "start");
    return;
  }
  if (changeInfo.status === 'complete') {
    await handleAutoRun(tab, "complete");
    return;
  }
});

addRuntimeOnMessageListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "dmt_retry_task") {
    const taskId = msg.taskId;
    (async () => {
      const task = await getTaskById(taskId);
      if (!task || !task.url) return;
      await updateTask(task.id, { status: "pending", lastError: "" });
      const tab = await tabsCreate({ url: task.url, active: false });
      if (tab && typeof tab.id === "number") {
        manualRetryByTabId.set(tab.id, task.id);
      }
    })();
    sendResponse({ ok: true });
  }
});

addTabsOnUpdatedListener(async (tabId, changeInfo, tab) => {
  const taskId = manualRetryByTabId.get(tabId);
  if (!taskId) return;
  if (changeInfo.status !== "complete") return;
  manualRetryByTabId.delete(tabId);
  try {
    const task = await getTaskById(taskId);
    if (!task) return;
    await runAutoTaskForTab(tab, task, "complete");
  } catch {}
});
