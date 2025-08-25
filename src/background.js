// Download Media Tabs — MV3 service worker (ES module)
// Now modularized into several focused modules for readability and maintenance.

import { setDefaultContextMenus, installActionClick, installContextMenuClick } from './menus.js';
import { runDownload } from './downloadOrchestrator.js';
import './downloadsState.js'; // side-effect: installs downloads onChanged listener

// Initialize context menus on install/startup
chrome.runtime.onInstalled.addListener(setDefaultContextMenus);
chrome.runtime.onStartup.addListener(setDefaultContextMenus);

// Wire action and context menu clicks to orchestrator
installActionClick(runDownload);
installContextMenuClick(runDownload);
