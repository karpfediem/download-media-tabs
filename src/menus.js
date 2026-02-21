import { getSettings } from './settings.js';
import {
  contextMenusRemoveAll,
  contextMenusCreate,
  addActionOnClickedListener,
  addContextMenusOnClickedListener,
  runtimeOpenOptionsPage
} from './chromeApi.js';

export function setDefaultContextMenus() {
  contextMenusRemoveAll(() => {
      contextMenusCreate({ id: "dmt-selected", title: "Download selected tabs", contexts: ["action"] });
      contextMenusCreate({ id: "dmt-current", title: "Download current window", contexts: ["action"] });
      contextMenusCreate({ id: "dmt-all", title: "Download all windows", contexts: ["action"] });
      contextMenusCreate({ id: "dmt-group", title: "Download current tab group", contexts: ["action"] });
      contextMenusCreate({ id: "dmt-left", title: "Download to the left (including current tab)", contexts: ["action"] });
      contextMenusCreate({ id: "dmt-right", title: "Download to the right (including current tab)", contexts: ["action"] });
      contextMenusCreate({ id: "separator-1", type: "separator", contexts: ["action"] });
      contextMenusCreate({ id: "open-options", title: "Options…", contexts: ["action"] });
  });
}

export function installActionClick(runDownload) {
  addActionOnClickedListener(async () => {
    const settings = await getSettings();
    await runDownload({ mode: settings.scope || "currentWindow" });
  });
}

export function installContextMenuClick(runDownload) {
  addContextMenusOnClickedListener(async (info) => {
    switch (info.menuItemId) {
      case "open-options":
        runtimeOpenOptionsPage();
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
