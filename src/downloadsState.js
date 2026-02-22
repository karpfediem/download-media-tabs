import { getSettings } from './settings.js';
import { closeTabRespectingWindow } from './closeTab.js';
import { updateTaskByDownloadId, removeTaskByDownloadId } from './tasksState.js';
import { interruptedUpdate } from './taskStatus.js';
import { MEDIA_EXTENSIONS } from './constants.js';
import { REASONS } from './reasons.js';
import {
  storageSessionGet,
  storageSessionSet,
  downloadsOnChangedAddListener,
  downloadsCancel,
  downloadsSearch,
  downloadsRemoveFile,
  downloadsErase,
  tabsGet
} from './chromeApi.js';

const SESSION_KEY = "dmtDownloadState";

export const downloadIdToMeta = new Map();
export const pendingSizeConstraints = new Map();

async function persistState() {
  try {
    const obj = {
      downloadIdToMeta: Array.from(downloadIdToMeta.entries()),
      pendingSizeConstraints: Array.from(pendingSizeConstraints.entries())
    };
    await storageSessionSet({ [SESSION_KEY]: obj });
  } catch {}
}

async function loadState() {
  try {
    const obj = await storageSessionGet({ [SESSION_KEY]: null });
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

export async function setDownloadTabMapping(downloadId, tabId, tabUrl, downloadUrl, closeOnStart = false, expectedExt = "") {
  if (typeof downloadId !== "number" || typeof tabId !== "number") return;
  downloadIdToMeta.set(downloadId, {
    tabId,
    tabUrl: tabUrl || "",
    downloadUrl: downloadUrl || "",
    closeOnStart: !!closeOnStart,
    expectedExt: expectedExt || ""
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

function normalizeExt(ext) {
  if (!ext) return "";
  const map = { jpeg: "jpg", jpe: "jpg", tiff: "tif", htm: "html" };
  let out = String(ext).toLowerCase().replace(/^\.+/, "");
  if (map[out]) out = map[out];
  return out;
}

function extFromFilename(filename) {
  if (!filename) return "";
  const base = String(filename).split(/[\\/]/).pop();
  if (!base) return "";
  const m = /\.([A-Za-z0-9]+)$/.exec(base);
  return m ? m[1].toLowerCase() : "";
}

function typeFromMime(mime) {
  if (!mime) return "";
  const m = String(mime).toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.startsWith("text/html")) return "html";
  return "";
}

function typeFromExt(ext) {
  if (!ext) return "";
  const mime = MEDIA_EXTENSIONS.get(ext);
  if (!mime) return "";
  return typeFromMime(mime);
}

function shouldWarnMismatch(expectedExt, actualExt, actualMime) {
  const expected = normalizeExt(expectedExt);
  const actual = normalizeExt(actualExt);
  if (!expected || expected === "bin" || !MEDIA_EXTENSIONS.has(expected)) return false;
  if (actual) return actual !== expected;
  const expectedType = typeFromExt(expected);
  const actualMimeType = typeFromMime(actualMime || "");
  if (!actualMimeType || !expectedType) return false;
  return actualMimeType !== expectedType;
}

downloadsOnChangedAddListener(async (delta) => {
  if (!delta || typeof delta.id !== "number") return;
  const id = delta.id;

  if (pendingSizeConstraints.has(id) && delta.bytesReceived && typeof delta.bytesReceived.current === "number") {
    const { maxBytes } = pendingSizeConstraints.get(id);
    const rec = delta.bytesReceived.current;
    if (maxBytes > 0 && rec > maxBytes) {
      await downloadsCancel(id);
      await removeTaskByDownloadId(id);
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
        await downloadsCancel(id);
        await removeTaskByDownloadId(id);
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
    const tabUrl = meta && typeof meta.tabUrl === "string" ? meta.tabUrl : "";
    const downloadUrl = meta && typeof meta.downloadUrl === "string" ? meta.downloadUrl : (meta && typeof meta.url === "string" ? meta.url : "");
    let item = null;
    try {
      if (pendingSizeConstraints.has(id)) {
        const { minBytes, maxBytes } = pendingSizeConstraints.get(id);
        await clearPendingSizeConstraint(id);

        const [found] = await downloadsSearch({ id });
        item = found || null;
        const finalBytes = item && Number.isFinite(item.fileSize) ? item.fileSize
          : (item && Number.isFinite(item.bytesReceived) ? item.bytesReceived : -1);

        const tooSmall = (minBytes > 0 && finalBytes >= 0 && finalBytes < minBytes);
        const tooLarge = (maxBytes > 0 && finalBytes >= 0 && finalBytes > maxBytes);

        if (tooSmall || tooLarge) {
          await downloadsRemoveFile(id);
          await downloadsErase({ id });
          await removeTaskByDownloadId(id);
          await clearDownloadTabMapping(id);
          return;
        }
      }

      if (!item) {
        const [found] = await downloadsSearch({ id });
        item = found || null;
      }

      const settings = await getSettings();
      const shouldClose = tabId != null && (settings.closeTabAfterDownload || (meta && meta.closeOnStart));
      if (shouldClose) {
        const guardUrl = tabUrl || downloadUrl;
        if (guardUrl) {
          try {
            const tab = await tabsGet(tabId);
            if (tab && tab.url !== guardUrl) {
              // Tab navigated elsewhere; skip auto-close.
              await updateTaskByDownloadId(id, { status: "completed" });
              await clearDownloadTabMapping(id);
              return;
            }
          } catch {}
        }
        await closeTabRespectingWindow(tabId, settings);
      }
      const expectedExt = meta && typeof meta.expectedExt === "string" ? meta.expectedExt : "";
      const actualExt = item ? extFromFilename(item.filename) : "";
      const actualMime = item && typeof item.mime === "string" ? item.mime : "";
      if (shouldWarnMismatch(expectedExt, actualExt, actualMime)) {
        await updateTaskByDownloadId(id, {
          status: "completed",
          lastError: REASONS.EXT_MISMATCH,
          expectedExt: normalizeExt(expectedExt),
          actualExt: normalizeExt(actualExt),
          actualMime: actualMime || ""
        });
      } else {
        await updateTaskByDownloadId(id, { status: "completed" });
      }
    } finally {
      await clearDownloadTabMapping(id);
    }
  }

  if (delta.error || (delta.state && delta.state.current === "interrupted")) {
    await clearPendingSizeConstraint(id);
    await clearDownloadTabMapping(id);
    const update = interruptedUpdate();
    if (update.action === "update") {
      await updateTaskByDownloadId(id, { status: update.status, lastError: update.lastError });
    }
  }

  if ((delta.state && delta.state.current === "in_progress") ||
      (delta.bytesReceived && typeof delta.bytesReceived.current === "number" && delta.bytesReceived.current > 0)) {
    const meta = downloadIdToMeta.get(id);
    if (meta && meta.closeOnStart && typeof meta.tabId === "number") {
      const tabUrl = typeof meta.tabUrl === "string" ? meta.tabUrl : "";
      const downloadUrl = typeof meta.downloadUrl === "string" ? meta.downloadUrl : (typeof meta.url === "string" ? meta.url : "");
      const guardUrl = tabUrl || downloadUrl;
      if (guardUrl) {
        try {
          const tab = await tabsGet(meta.tabId);
          if (!tab || tab.url !== guardUrl) {
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
