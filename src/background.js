// Download Media Tabs — MV3 service worker (ES module)
// Now modularized into several focused modules for readability and maintenance.

import { setDefaultContextMenus, installActionClick, installContextMenuClick } from './menus.js';
import { runDownload, runDownloadForTab } from './downloadOrchestrator.js';
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
const lastProcessedUrlByTab = new Map();

async function refreshAutoRunSetting() {
  try {
    const obj = await chrome.storage.sync.get({ autoRunOnNewTabs: false });
    autoRunEnabled = !!obj.autoRunOnNewTabs;
  } catch {
    autoRunEnabled = false;
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
  if (area === 'sync' && changes && Object.prototype.hasOwnProperty.call(changes, 'autoRunOnNewTabs')) {
    autoRunEnabled = !!(changes.autoRunOnNewTabs.newValue);
    autoRunLoaded = true;
  }
});

// Clean up cache when tab is removed
chrome.tabs.onRemoved.addListener((tabId) => {
  lastProcessedUrlByTab.delete(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Ensure we have loaded the setting at least once in this SW lifetime
  if (!autoRunLoaded) {
    try { await refreshAutoRunSetting(); } catch {}
  }
  if (!autoRunEnabled) return;
  if (!tab || !tab.url) return;
  if (changeInfo.status !== 'complete') return;
  try {
    const u = new URL(tab.url);
    if (!['http:', 'https:', 'file:', 'ftp:', 'data:'].includes(u.protocol)) return;
  } catch { return; }

  const prevUrl = lastProcessedUrlByTab.get(tabId);
  if (prevUrl === tab.url) return;
  lastProcessedUrlByTab.set(tabId, tab.url);
  try {
    await runDownloadForTab(tab);
  } catch {}
});
