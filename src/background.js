// Download Media Tabs — MV3 service worker (ES module)
// Now modularized into several focused modules for readability and maintenance.

import { setDefaultContextMenus, installActionClick, installContextMenuClick } from './menus.js';
import { runDownload, runDownloadForTab } from './downloadOrchestrator.js';
import { closeTabRespectingWindow } from './closeTab.js';
import './downloadsState.js'; // side-effect: installs downloads onChanged listener

// Initialize context menus on install/startup
chrome.runtime.onInstalled.addListener((details) => {
  try { setDefaultContextMenus(); } catch {}
  if (details?.reason === 'install') {
    // Mark first-install so the Options page can show a welcome toast
    chrome.storage?.local?.set({ shouldShowWelcome: true, firstInstallAt: Date.now() });
    // Open the Options page on first install
    if (chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    }
  }
});
chrome.runtime.onStartup.addListener(setDefaultContextMenus);

// Wire action and context menu clicks to orchestrator
installActionClick(runDownload);
installContextMenuClick(runDownload);

// Auto-run on new tabs if enabled in settings
let autoRunEnabled = false;
let autoRunLoaded = false; // whether we have read the setting in this SW lifetime
let autoRunTiming = "complete";
let autoCloseOnStart = false;
let keepWindowOpenOnLastTabClose = false;
const lastProcessedUrlByTab = new Map();
const pendingAutoRunUrlByTab = new Map();
const AUTO_RUN_FALLBACK_MS = 8000;

async function refreshAutoRunSetting() {
  try {
    const obj = await chrome.storage.sync.get({
      autoRunOnNewTabs: false,
      autoRunTiming: "complete",
      autoCloseOnStart: false,
      keepWindowOpenOnLastTabClose: false
    });
    autoRunEnabled = !!obj.autoRunOnNewTabs;
    autoRunTiming = (obj.autoRunTiming === "start" || obj.autoRunTiming === "complete") ? obj.autoRunTiming : "complete";
    autoCloseOnStart = !!obj.autoCloseOnStart;
    keepWindowOpenOnLastTabClose = !!obj.keepWindowOpenOnLastTabClose;
  } catch {
    autoRunEnabled = false;
    autoRunTiming = "complete";
    autoCloseOnStart = false;
    keepWindowOpenOnLastTabClose = false;
  } finally {
    autoRunLoaded = true;
  }
}

// Proactively load setting on service worker start
// (MV3 SW can spin down and restart; this ensures the flag is populated on each load)
try { refreshAutoRunSetting(); } catch {}

// Initialize setting on startup and install
chrome.runtime.onStartup.addListener(refreshAutoRunSetting);
chrome.runtime.onInstalled.addListener(refreshAutoRunSetting);

// React to settings changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !changes) return;
  if (Object.prototype.hasOwnProperty.call(changes, 'autoRunOnNewTabs')) {
    autoRunEnabled = !!(changes.autoRunOnNewTabs.newValue);
    autoRunLoaded = true;
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
chrome.tabs.onRemoved.addListener((tabId) => {
  lastProcessedUrlByTab.delete(tabId);
  pendingAutoRunUrlByTab.delete(tabId);
  try { chrome.alarms.clear(`dmt-auto-${tabId}`); } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Ensure we have loaded the setting at least once in this SW lifetime
  if (!autoRunLoaded) {
    try { await refreshAutoRunSetting(); } catch {}
  }
  if (!autoRunEnabled) return;
  if (!tab || !tab.url) return;
  try {
    const u = new URL(tab.url);
    if (!['http:', 'https:', 'file:', 'ftp:', 'data:'].includes(u.protocol)) return;
  } catch { return; }

  if (changeInfo.status === 'loading') {
    if (autoRunTiming === "start") {
      const prevUrl = lastProcessedUrlByTab.get(tabId);
      if (prevUrl === tab.url) return;
      lastProcessedUrlByTab.set(tabId, tab.url);
      pendingAutoRunUrlByTab.delete(tabId);
      try { chrome.alarms.clear(`dmt-auto-${tabId}`); } catch {}
      try {
        const downloadId = await runDownloadForTab(tab);
        if (autoCloseOnStart && typeof downloadId === "number") {
          await closeTabRespectingWindow(tabId, { keepWindowOpenOnLastTabClose });
        }
      } catch {}
      return;
    }
    pendingAutoRunUrlByTab.set(tabId, tab.url);
    try {
      chrome.alarms.create(`dmt-auto-${tabId}`, { when: Date.now() + AUTO_RUN_FALLBACK_MS });
    } catch {}
    return;
  }
  if (changeInfo.status !== 'complete') return;

  const prevUrl = lastProcessedUrlByTab.get(tabId);
  if (prevUrl === tab.url) return;
  lastProcessedUrlByTab.set(tabId, tab.url);
  pendingAutoRunUrlByTab.delete(tabId);
  try { chrome.alarms.clear(`dmt-auto-${tabId}`); } catch {}
  try {
    const downloadId = await runDownloadForTab(tab);
    if (autoCloseOnStart && typeof downloadId === "number") {
      await closeTabRespectingWindow(tabId, { keepWindowOpenOnLastTabClose });
    }
  } catch {}
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const name = String(alarm?.name || "");
  if (!name.startsWith("dmt-auto-")) return;
  if (!autoRunEnabled) return;
  const tabId = Number(name.slice("dmt-auto-".length));
  if (!Number.isFinite(tabId)) return;
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  if (!tab || !tab.url) return;
  const pendingUrl = pendingAutoRunUrlByTab.get(tabId);
  if (pendingUrl && pendingUrl !== tab.url) return;
  const prevUrl = lastProcessedUrlByTab.get(tabId);
  if (prevUrl === tab.url) return;
  lastProcessedUrlByTab.set(tabId, tab.url);
  pendingAutoRunUrlByTab.delete(tabId);
  try {
    const downloadId = await runDownloadForTab(tab);
    if (autoCloseOnStart && typeof downloadId === "number") {
      await closeTabRespectingWindow(tabId, { keepWindowOpenOnLastTabClose });
    }
  } catch {}
});
