import {getSettings} from './settings.js';

export function setDefaultContextMenus() {
  chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: "dmt-selected", title: "Download selected tabs", contexts: ["action"] });
      chrome.contextMenus.create({ id: "dmt-current", title: "Download current window", contexts: ["action"] });
      chrome.contextMenus.create({ id: "dmt-all", title: "Download all windows", contexts: ["action"] });
      chrome.contextMenus.create({ id: "dmt-group", title: "Download current tab group", contexts: ["action"] });
      chrome.contextMenus.create({ id: "dmt-left", title: "Download to the left (including current tab)", contexts: ["action"] });
      chrome.contextMenus.create({ id: "dmt-right", title: "Download to the right (including current tab)", contexts: ["action"] });
      chrome.contextMenus.create({ id: "separator-1", type: "separator", contexts: ["action"] });
      chrome.contextMenus.create({ id: "open-options", title: "Options…", contexts: ["action"] });
  });
}

export function installActionClick(runDownload) {
  chrome.action.onClicked.addListener(async () => {
    const settings = await getSettings();
    await runDownload({ mode: settings.scope || "currentWindow" });
  });
}

export function installContextMenuClick(runDownload) {
  chrome.contextMenus.onClicked.addListener(async (info) => {
    switch (info.menuItemId) {
      case "open-options":
        chrome.runtime.openOptionsPage();
        return;
      case "dmt-current":
        await runDownload({ mode: "currentWindow" }); return;
      case "dmt-all":
        await runDownload({ mode: "allWindows" }); return;
      case "dmt-selected":
        await runDownload({ mode: "selectedTabs" }); return;
      case "dmt-left":
        await runDownload({ mode: "leftOfActive" }); return;
      case "dmt-right":
        await runDownload({ mode: "rightOfActive" }); return;
      case "dmt-group":
        await runDownload({ mode: "currentGroup" }); return;
    }
  });
}
