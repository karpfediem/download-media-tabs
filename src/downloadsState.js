import { getSettings } from './settings.js';
import { closeTabRespectingWindow } from './closeTab.js';

const SESSION_KEY = "dmtDownloadState";

export const downloadIdToTabId = new Map();
export const pendingSizeConstraints = new Map();

async function persistState() {
  try {
    const obj = {
      downloadIdToTabId: Array.from(downloadIdToTabId.entries()),
      pendingSizeConstraints: Array.from(pendingSizeConstraints.entries())
    };
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [SESSION_KEY]: obj });
    }
  } catch {}
}

async function loadState() {
  try {
    if (!chrome.storage?.session) return;
    const obj = await chrome.storage.session.get({ [SESSION_KEY]: null });
    const data = obj && obj[SESSION_KEY];
    if (!data) return;
    if (Array.isArray(data.downloadIdToTabId)) {
      for (const [id, tabId] of data.downloadIdToTabId) {
        if (typeof id === "number" && typeof tabId === "number") {
          downloadIdToTabId.set(id, tabId);
        }
      }
    }
    if (Array.isArray(data.pendingSizeConstraints)) {
      for (const [id, payload] of data.pendingSizeConstraints) {
        if (typeof id === "number" && payload && typeof payload === "object") {
          pendingSizeConstraints.set(id, payload);
        }
      }
    }
  } catch {}
}

export async function setDownloadTabMapping(downloadId, tabId) {
  if (typeof downloadId !== "number" || typeof tabId !== "number") return;
  downloadIdToTabId.set(downloadId, tabId);
  await persistState();
}

export async function clearDownloadTabMapping(downloadId) {
  if (typeof downloadId !== "number") return;
  downloadIdToTabId.delete(downloadId);
  await persistState();
}

export async function setPendingSizeConstraint(downloadId, payload) {
  if (typeof downloadId !== "number" || !payload || typeof payload !== "object") return;
  pendingSizeConstraints.set(downloadId, payload);
  await persistState();
}

export async function clearPendingSizeConstraint(downloadId) {
  if (typeof downloadId !== "number") return;
  pendingSizeConstraints.delete(downloadId);
  await persistState();
}

try { loadState(); } catch {}

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta || typeof delta.id !== "number") return;
  const id = delta.id;

  if (pendingSizeConstraints.has(id) && delta.bytesReceived && typeof delta.bytesReceived.current === "number") {
    const { maxBytes } = pendingSizeConstraints.get(id);
    const rec = delta.bytesReceived.current;
    if (maxBytes > 0 && rec > maxBytes) {
      try { await chrome.downloads.cancel(id); } catch {}
      await clearPendingSizeConstraint(id);
      await clearDownloadTabMapping(id);
      return;
    }
  }

  if (pendingSizeConstraints.has(id) && delta.totalBytes && typeof delta.totalBytes.current === "number") {
    const { minBytes, maxBytes } = pendingSizeConstraints.get(id);
    const total = delta.totalBytes.current;
    if (total >= 0) {
      if ((minBytes > 0 && total < minBytes) || (maxBytes > 0 && total > maxBytes)) {
        try { await chrome.downloads.cancel(id); } catch {}
        await clearPendingSizeConstraint(id);
        await clearDownloadTabMapping(id);
        return;
      }
      await clearPendingSizeConstraint(id);
    }
  }

  if (delta.state && delta.state.current === "complete") {
    const tabId = downloadIdToTabId.get(id);
    try {
      if (pendingSizeConstraints.has(id)) {
        const { minBytes, maxBytes } = pendingSizeConstraints.get(id);
        await clearPendingSizeConstraint(id);

        const [item] = await chrome.downloads.search({ id });
        const finalBytes = item && Number.isFinite(item.fileSize) ? item.fileSize
            : (item && Number.isFinite(item.bytesReceived) ? item.bytesReceived : -1);

        const tooSmall = (minBytes > 0 && finalBytes >= 0 && finalBytes < minBytes);
        const tooLarge = (maxBytes > 0 && finalBytes >= 0 && finalBytes > maxBytes);

        if (tooSmall || tooLarge) {
          try { await chrome.downloads.removeFile(id); } catch {}
          try { await chrome.downloads.erase({ id }); } catch {}
          await clearDownloadTabMapping(id);
          return;
        }
      }

      const settings = await getSettings();
      if (tabId != null && settings.closeTabAfterDownload) {
        await closeTabRespectingWindow(tabId, settings);
      }
    } finally {
      await clearDownloadTabMapping(id);
    }
  }

  if (delta.error || (delta.state && delta.state.current === "interrupted")) {
    await clearPendingSizeConstraint(id);
    await clearDownloadTabMapping(id);
  }
});
