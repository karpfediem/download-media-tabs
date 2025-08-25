import { getSettings } from './settings.js';

export function setDefaultContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "dmt-current", title: "Download media tabs (current window)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "dmt-all",     title: "Download media tabs (all windows)",    contexts: ["action"] });
    chrome.contextMenus.create({ id: "dmt-left",    title: "Download media tabs to the LEFT (incl. current)",  contexts: ["action"] });
    chrome.contextMenus.create({ id: "dmt-right",   title: "Download media tabs to the RIGHT (incl. current)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "dmt-group",   title: "Download media tabs in CURRENT TAB GROUP",         contexts: ["action"] });
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
      case "dmt-left":
        await runDownload({ mode: "leftOfActive" }); return;
      case "dmt-right":
        await runDownload({ mode: "rightOfActive" }); return;
      case "dmt-group":
        await runDownload({ mode: "currentGroup" }); return;
    }
  });
}
