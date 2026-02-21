import { createStorageFixture, createDownloadsStub, createTabsStub, createChromeBase, ref } from "./chrome-stubs.mjs";

export function setupRunDownloadFixture({ tabs = [], sync = {}, contentLengthForUrl } = {}) {
  const storageFixture = createStorageFixture({ sync });
  const storage = storageFixture.storage;
  const downloadCalls = [];
  const nextDownloadId = ref(1);

  const downloads = createDownloadsStub({
    downloadCalls,
    nextDownloadIdRef: nextDownloadId
  });
  const tabsApi = createTabsStub({
    query: async () => tabs,
    get: async (tabId) => tabs.find(t => t.id === tabId) || null
  });

  globalThis.chrome = createChromeBase({ storageFixture, downloads, tabs: tabsApi });

  if (typeof contentLengthForUrl === "function") {
    globalThis.fetch = async (url) => ({
      ok: true,
      headers: {
        get: (name) => {
          if (String(name).toLowerCase() !== "content-length") return null;
          const len = contentLengthForUrl(url);
          return Number.isFinite(len) ? String(len) : null;
        }
      }
    });
  }

  return { storage, downloadCalls };
}
