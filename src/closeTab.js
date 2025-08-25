export async function closeTabRespectingWindow(tabId, settings) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || typeof tab.windowId !== "number") {
      chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
      return;
    }
    if (!settings.keepWindowOpenOnLastTabClose) {
      chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
      return;
    }

    const tabsInWindow = await chrome.tabs.query({ windowId: tab.windowId });
    if (!Array.isArray(tabsInWindow) || tabsInWindow.length <= 1) {
      try {
        await chrome.tabs.create({ windowId: tab.windowId, url: "chrome://newtab/" });
      } catch {}
    }
    chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
  } catch {}
}
