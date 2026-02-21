import { tabsGet, tabsRemove, tabsQuery, tabsCreate, getRuntimeLastError } from "./chromeApi.js";

export async function closeTabRespectingWindow(tabId, settings) {
  try {
    const tab = await tabsGet(tabId);
    if (!tab || typeof tab.windowId !== "number") {
      tabsRemove(tabId, () => void getRuntimeLastError());
      return;
    }
    if (!settings.keepWindowOpenOnLastTabClose) {
      tabsRemove(tabId, () => void getRuntimeLastError());
      return;
    }

    const tabsInWindow = await tabsQuery({ windowId: tab.windowId });
    if (!Array.isArray(tabsInWindow) || tabsInWindow.length <= 1) {
      try {
        await tabsCreate({ windowId: tab.windowId, url: "chrome://newtab/" });
      } catch {}
    }
    tabsRemove(tabId, () => void getRuntimeLastError());
  } catch {}
}
