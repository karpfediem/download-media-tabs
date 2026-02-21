import { getSettings } from './settings.js';
import { closeTabRespectingWindow } from './closeTab.js';
import { updateTaskByDownloadId } from './tasksState.js';

const SESSION_KEY = "dmtDownloadState";

export const downloadIdToMeta = new Map();
export const pendingSizeConstraints = new Map();

async function persistState() {
  try {
    const obj = {
      downloadIdToMeta: Array.from(downloadIdToMeta.entries()),
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
    if (Array.isArray(data.downloadIdToMeta)) {
      for (const [id, meta] of data.downloadIdToMeta) {
        if (typeof id === "number" && meta && typeof meta === "object") {
          downloadIdToMeta.set(id, meta);
        }
      }
    }
    if (Array.isArray(data.downloadIdToTabId)) {
      for (const [id, tabId] of data.downloadIdToTabId) {
        if (typeof id === "number" && typeof tabId === "number") {
          downloadIdToMeta.set(id, { tabId });
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

export async function setDownloadTabMapping(downloadId, tabId, url, closeOnStart = false) {
  if (typeof downloadId !== "number" || typeof tabId !== "number") return;
  downloadIdToMeta.set(downloadId, {
    tabId,
    url: url || "",
    closeOnStart: !!closeOnStart
  });
  await persistState();
}

export async function clearDownloadTabMapping(downloadId) {
  if (typeof downloadId !== "number") return;
  downloadIdToMeta.delete(downloadId);
  await persistState();
}

export function hasActiveDownloadForTab(tabId) {
  if (typeof tabId !== "number") return false;
  for (const meta of downloadIdToMeta.values()) {
    if (meta && meta.tabId === tabId) return true;
  }
  return false;
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
    const meta = downloadIdToMeta.get(id);
    const tabId = meta && typeof meta.tabId === "number" ? meta.tabId : null;
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
        if (meta && meta.url) {
          try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.url !== meta.url) {
              // Tab navigated elsewhere; skip auto-close.
              await updateTaskByDownloadId(id, { status: "completed" });
              await clearDownloadTabMapping(id);
              return;
            }
          } catch {}
        }
        await closeTabRespectingWindow(tabId, settings);
      }
      await updateTaskByDownloadId(id, { status: "completed" });
    } finally {
      await clearDownloadTabMapping(id);
    }
  }

  if (delta.error || (delta.state && delta.state.current === "interrupted")) {
    await clearPendingSizeConstraint(id);
    await clearDownloadTabMapping(id);
    await updateTaskByDownloadId(id, { status: "failed", lastError: "interrupted" });
  }

  if ((delta.state && delta.state.current === "in_progress") ||
      (delta.bytesReceived && typeof delta.bytesReceived.current === "number" && delta.bytesReceived.current > 0)) {
    const meta = downloadIdToMeta.get(id);
    if (meta && meta.closeOnStart && typeof meta.tabId === "number") {
      if (meta.url) {
        try {
          const tab = await chrome.tabs.get(meta.tabId);
          if (!tab || tab.url !== meta.url) {
            meta.closeOnStart = false;
            downloadIdToMeta.set(id, meta);
            await persistState();
            return;
          }
        } catch {
          meta.closeOnStart = false;
          downloadIdToMeta.set(id, meta);
          await persistState();
          return;
        }
      }
      try { await closeTabRespectingWindow(meta.tabId, await getSettings()); } catch {}
      meta.closeOnStart = false;
      downloadIdToMeta.set(id, meta);
      await persistState();
    }
  }
});
