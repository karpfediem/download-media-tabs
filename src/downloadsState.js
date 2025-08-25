import { getSettings } from './settings.js';
import { closeTabRespectingWindow } from './closeTab.js';

export const downloadIdToTabId = new Map();
export const pendingSizeConstraints = new Map();

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta || typeof delta.id !== "number") return;
  const id = delta.id;

  if (pendingSizeConstraints.has(id) && delta.bytesReceived && typeof delta.bytesReceived.current === "number") {
    const { maxBytes } = pendingSizeConstraints.get(id);
    const rec = delta.bytesReceived.current;
    if (maxBytes > 0 && rec > maxBytes) {
      try { await chrome.downloads.cancel(id); } catch {}
      pendingSizeConstraints.delete(id);
      downloadIdToTabId.delete(id);
      return;
    }
  }

  if (pendingSizeConstraints.has(id) && delta.totalBytes && typeof delta.totalBytes.current === "number") {
    const { minBytes, maxBytes } = pendingSizeConstraints.get(id);
    const total = delta.totalBytes.current;
    if (total >= 0) {
      if ((minBytes > 0 && total < minBytes) || (maxBytes > 0 && total > maxBytes)) {
        try { await chrome.downloads.cancel(id); } catch {}
        pendingSizeConstraints.delete(id);
        downloadIdToTabId.delete(id);
        return;
      }
      pendingSizeConstraints.delete(id);
    }
  }

  if (delta.state && delta.state.current === "complete") {
    const tabId = downloadIdToTabId.get(id);
    try {
      if (pendingSizeConstraints.has(id)) {
        const { minBytes, maxBytes } = pendingSizeConstraints.get(id);
        pendingSizeConstraints.delete(id);

        const [item] = await chrome.downloads.search({ id });
        const finalBytes = item && Number.isFinite(item.fileSize) ? item.fileSize
            : (item && Number.isFinite(item.bytesReceived) ? item.bytesReceived : -1);

        const tooSmall = (minBytes > 0 && finalBytes >= 0 && finalBytes < minBytes);
        const tooLarge = (maxBytes > 0 && finalBytes >= 0 && finalBytes > maxBytes);

        if (tooSmall || tooLarge) {
          try { await chrome.downloads.removeFile(id); } catch {}
          try { await chrome.downloads.erase({ id }); } catch {}
          downloadIdToTabId.delete(id);
          return;
        }
      }

      const settings = await getSettings();
      if (tabId != null && settings.closeTabAfterDownload) {
        await closeTabRespectingWindow(tabId, settings);
      }
    } finally {
      downloadIdToTabId.delete(id);
    }
  }

  if (delta.error || (delta.state && delta.state.current === "interrupted")) {
    pendingSizeConstraints.delete(id);
    downloadIdToTabId.delete(id);
  }
});
