// Download Media Tabs — MV3 service worker (ES module)
// Now modularized into several focused modules for readability and maintenance.

import { setDefaultContextMenus, installActionClick, installContextMenuClick } from './menus.js';
import { runDownload, runTaskForTab } from './downloadOrchestrator.js';
import {
  upsertTask,
  updateTask,
  getTasks,
  getTaskById,
  markTasksForClosedTab,
  findTaskByTabUrlKind,
  cleanupTasks
} from './tasksState.js';
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
  addRuntimeOnMessageListener,
  alarmsCreate,
  alarmsClear,
  addAlarmsOnAlarmListener
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
let autoRunPendingIntervalMin = 5;
let taskCleanupMaxAgeMin = 0;
let taskCleanupMaxCount = 0;
const lastProcessedUrlByTab = new Map();
const manualRetryByTabId = new Map();
const PENDING_ALARM = "dmt-pending-tasks";
const CLEANUP_ALARM = "dmt-task-cleanup";
const CLEANUP_INTERVAL_MIN = 5;

function schedulePendingAlarm() {
  if (!autoRunEnabled || autoRunPendingIntervalMin <= 0) {
    alarmsClear(PENDING_ALARM);
    return;
  }
  const interval = Math.max(1, Math.min(120, Number(autoRunPendingIntervalMin) || 0));
  if (!interval) {
    alarmsClear(PENDING_ALARM);
    return;
  }
  alarmsCreate(PENDING_ALARM, { periodInMinutes: interval });
}

function scheduleCleanupAlarm() {
  if (taskCleanupMaxAgeMin <= 0 && taskCleanupMaxCount <= 0) {
    alarmsClear(CLEANUP_ALARM);
    return;
  }
  alarmsCreate(CLEANUP_ALARM, { periodInMinutes: CLEANUP_INTERVAL_MIN });
}

async function refreshAutoRunSetting() {
  try {
    const obj = await storageSyncGet({
      autoRunOnNewTabs: false,
      autoRunTiming: "start",
      autoCloseOnStart: false,
      autoRunPendingIntervalMin: 5,
      keepWindowOpenOnLastTabClose: false,
      taskCleanupMaxAgeMin: 0,
      taskCleanupMaxCount: 0
    });
    autoRunEnabled = !!obj.autoRunOnNewTabs;
    autoRunTiming = (obj.autoRunTiming === "start" || obj.autoRunTiming === "complete") ? obj.autoRunTiming : "start";
    autoCloseOnStart = !!obj.autoCloseOnStart;
    autoRunPendingIntervalMin = Number.isFinite(Number(obj.autoRunPendingIntervalMin))
      ? Number(obj.autoRunPendingIntervalMin)
      : 5;
    keepWindowOpenOnLastTabClose = !!obj.keepWindowOpenOnLastTabClose;
    taskCleanupMaxAgeMin = Number.isFinite(Number(obj.taskCleanupMaxAgeMin))
      ? Number(obj.taskCleanupMaxAgeMin)
      : 0;
    taskCleanupMaxCount = Number.isFinite(Number(obj.taskCleanupMaxCount))
      ? Number(obj.taskCleanupMaxCount)
      : 0;
  } catch {
    autoRunEnabled = false;
    autoRunTiming = "start";
    autoCloseOnStart = false;
    autoRunPendingIntervalMin = 5;
    keepWindowOpenOnLastTabClose = false;
    taskCleanupMaxAgeMin = 0;
    taskCleanupMaxCount = 0;
  } finally {
    autoRunLoaded = true;
    schedulePendingAlarm();
    scheduleCleanupAlarm();
    if (taskCleanupMaxAgeMin > 0 || taskCleanupMaxCount > 0) {
      try { await cleanupTasks({ maxAgeMin: taskCleanupMaxAgeMin, maxCount: taskCleanupMaxCount }); } catch {}
    }
  }
}

async function runAutoTaskForTab(tab, task, phase) {
  if (!tab || !tab.url) return;
  const retryOnComplete = false;
  try {
    await runTaskForTab(tab, task.id, { closeOnStart: autoCloseOnStart, retryOnComplete });
  } catch {
    await updateTask(task.id, {
      status: "failed",
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
  if (existing && existing.status === "pending" && !shouldRun) {
    await updateTask(existing.id, { status: "failed", lastError: REASONS.NO_DOWNLOAD });
    return;
  }

  const task = existing || await upsertTask({ tabId: tab.id, url: tab.url, kind: "auto" });
  if (task.status !== "pending") return;
  if (!shouldRun) return;

  lastProcessedUrlByTab.set(tab.id, tab.url);
  await runAutoTaskForTab(tab, task, phase);
}

async function processPendingTasks() {
  const tasks = await getTasks();
  if (!tasks.length) return;
  const pending = tasks.filter(t => t && t.status === "pending");
  if (!pending.length) return;
  for (const task of pending) {
    const kind = task.kind || "auto";
    const manualPending = task.pendingRunOn === "complete" || kind === "manual";
    const autoPending = !manualPending && kind === "auto";
    if (autoPending && !autoRunEnabled) continue;
    let tab;
    try { tab = await tabsGet(task.tabId); } catch { tab = null; }
    if (!tab || tab.url !== task.url) {
      await updateTask(task.id, { status: "failed", lastError: REASONS.NO_TAB });
      continue;
    }
    if (manualPending) {
      if (tab.status !== "complete") continue;
      await runAutoTaskForTab(tab, task, "complete");
      continue;
    }
    if (autoRunTiming === "complete" && tab.status !== "complete") {
      await updateTask(task.id, { status: "failed", lastError: REASONS.NO_DOWNLOAD });
      continue;
    }
    if (autoRunTiming === "start" && tab.status !== "loading" && tab.status !== "complete") {
      await updateTask(task.id, { status: "failed", lastError: REASONS.NO_DOWNLOAD });
      continue;
    }
    if (autoRunTiming === "start" && tab.status === "complete" && task.lastError !== REASONS.NO_DOWNLOAD) {
      await updateTask(task.id, { status: "failed", lastError: REASONS.NO_DOWNLOAD });
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
    schedulePendingAlarm();
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
  if (Object.prototype.hasOwnProperty.call(changes, 'autoRunPendingIntervalMin')) {
    const next = Number(changes.autoRunPendingIntervalMin.newValue);
    autoRunPendingIntervalMin = Number.isFinite(next) ? next : 5;
    schedulePendingAlarm();
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'taskCleanupMaxAgeMin')) {
    const next = Number(changes.taskCleanupMaxAgeMin.newValue);
    taskCleanupMaxAgeMin = Number.isFinite(next) ? next : 0;
    scheduleCleanupAlarm();
    if (taskCleanupMaxAgeMin > 0 || taskCleanupMaxCount > 0) {
      try { cleanupTasks({ maxAgeMin: taskCleanupMaxAgeMin, maxCount: taskCleanupMaxCount }); } catch {}
    }
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'taskCleanupMaxCount')) {
    const next = Number(changes.taskCleanupMaxCount.newValue);
    taskCleanupMaxCount = Number.isFinite(next) ? next : 0;
    scheduleCleanupAlarm();
    if (taskCleanupMaxAgeMin > 0 || taskCleanupMaxCount > 0) {
      try { cleanupTasks({ maxAgeMin: taskCleanupMaxAgeMin, maxCount: taskCleanupMaxCount }); } catch {}
    }
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

addAlarmsOnAlarmListener((alarm) => {
  if (!alarm) return;
  if (alarm.name === PENDING_ALARM) {
    try { processPendingTasks(); } catch {}
    return;
  }
  if (alarm.name === CLEANUP_ALARM) {
    try { cleanupTasks({ maxAgeMin: taskCleanupMaxAgeMin, maxCount: taskCleanupMaxCount }); } catch {}
  }
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
  if (msg.type === "dmt_start_task") {
    const taskId = msg.taskId;
    (async () => {
      const task = await getTaskById(taskId);
      if (!task || !task.url) return;
      let tab = null;
      if (typeof task.tabId === "number") {
        try { tab = await tabsGet(task.tabId); } catch { tab = null; }
      }
      if (!tab || tab.url !== task.url) {
        await updateTask(task.id, { status: "failed", lastError: REASONS.NO_TAB });
        return;
      }
      await updateTask(task.id, { status: "pending", lastError: "" });
      await runAutoTaskForTab(tab, task, "start");
    })();
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === "dmt_retry_task") {
    const taskId = msg.taskId;
    (async () => {
      const task = await getTaskById(taskId);
      if (!task || !task.url) return;
      const tab = await tabsCreate({ url: task.url, active: false });
      if (tab && typeof tab.id === "number") {
        manualRetryByTabId.set(tab.id, task.id);
        await updateTask(task.id, {
          status: "pending",
          lastError: "",
          tabId: tab.id,
          url: task.url,
          pendingRunOn: "complete"
        });
      } else {
        await updateTask(task.id, { status: "failed", lastError: REASONS.NO_TAB });
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
