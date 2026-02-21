/** @returns {any} */
function getChrome() {
  return globalThis.chrome;
}

/** @param {"sync"|"local"|"session"} area @returns {any|null} */
function safeStorageArea(area) {
  const chrome = getChrome();
  return chrome?.storage?.[area] || null;
}

/** @param {Object} defaults @returns {Promise<Object>} */
export function storageSyncGet(defaults) {
  const sync = safeStorageArea("sync");
  return new Promise(resolve => {
    if (!sync?.get) return resolve(defaults || {});
    try {
      sync.get(defaults, resolve);
    } catch {
      resolve(defaults || {});
    }
  });
}

/** @param {Object} obj @returns {Promise<void>} */
export async function storageSyncSet(obj) {
  const sync = safeStorageArea("sync");
  if (!sync?.set) return;
  try { await sync.set(obj); } catch {}
}

/** @param {"local"|"session"} area @param {Object} defaults @returns {Promise<Object>} */
function storageAreaGet(area, defaults) {
  const api = safeStorageArea(area);
  return new Promise(resolve => {
    if (!api?.get) return resolve(defaults || {});
    try {
      if (api.get.length >= 2) {
        api.get(defaults, resolve);
      } else {
        Promise.resolve(api.get(defaults)).then(resolve, () => resolve(defaults || {}));
      }
    } catch {
      resolve(defaults || {});
    }
  });
}

/** @param {"local"|"session"} area @param {Object} obj @returns {Promise<void>} */
async function storageAreaSet(area, obj) {
  const api = safeStorageArea(area);
  if (!api?.set) return;
  try { await api.set(obj); } catch {}
}

/** @param {Object} defaults @returns {Promise<Object>} */
export function storageLocalGet(defaults) {
  return storageAreaGet("local", defaults);
}

/** @param {Object} defaults @returns {Promise<Object>} */
export function storageSessionGet(defaults) {
  return storageAreaGet("session", defaults);
}

/** @param {Object} obj @returns {Promise<void>} */
export async function storageLocalSet(obj) {
  await storageAreaSet("local", obj);
}

/** @param {Object} obj @returns {Promise<void>} */
export async function storageSessionSet(obj) {
  await storageAreaSet("session", obj);
}

/** @param {Function} fn */
export function addStorageOnChangedListener(fn) {
  const chrome = getChrome();
  chrome?.storage?.onChanged?.addListener(fn);
}

/** @param {Object} query @returns {Promise<boolean>} */
export function permissionsContains(query) {
  const chrome = getChrome();
  return new Promise(resolve => {
    if (!chrome?.permissions?.contains) return resolve(false);
    chrome.permissions.contains(query, ok => resolve(!!ok));
  });
}

/** @param {Function} fn */
export function downloadsOnChangedAddListener(fn) {
  const chrome = getChrome();
  chrome?.downloads?.onChanged?.addListener(fn);
}

/** @param {Object} opts @returns {Promise<number|null>} */
export async function downloadsDownload(opts) {
  const chrome = getChrome();
  if (!chrome?.downloads?.download) return null;
  try { return await chrome.downloads.download(opts); } catch { return null; }
}

/** @param {Object} query @returns {Promise<Array>} */
export async function downloadsSearch(query) {
  const chrome = getChrome();
  if (!chrome?.downloads?.search) return [];
  try { return await chrome.downloads.search(query); } catch { return []; }
}

/** @param {number} id @returns {Promise<void>} */
export async function downloadsCancel(id) {
  const chrome = getChrome();
  if (!chrome?.downloads?.cancel) return;
  try { await chrome.downloads.cancel(id); } catch {}
}

/** @param {number} id @returns {Promise<void>} */
export async function downloadsRemoveFile(id) {
  const chrome = getChrome();
  if (!chrome?.downloads?.removeFile) return;
  try { await chrome.downloads.removeFile(id); } catch {}
}

/** @param {Object} query @returns {Promise<void>} */
export async function downloadsErase(query) {
  const chrome = getChrome();
  if (!chrome?.downloads?.erase) return;
  try { await chrome.downloads.erase(query); } catch {}
}

/** @param {number} tabId @returns {Promise<Object|null>} */
export async function tabsGet(tabId) {
  const chrome = getChrome();
  if (!chrome?.tabs?.get) return null;
  try { return await chrome.tabs.get(tabId); } catch { return null; }
}

/** @param {Object} query @returns {Promise<Array>} */
export async function tabsQuery(query) {
  const chrome = getChrome();
  if (!chrome?.tabs?.query) return [];
  try { return await chrome.tabs.query(query); } catch { return []; }
}

/** @param {number} tabId @param {Function=} cb */
export function tabsRemove(tabId, cb) {
  const chrome = getChrome();
  if (!chrome?.tabs?.remove) return;
  chrome.tabs.remove(tabId, cb);
}

/** @param {Object} opts @returns {Promise<Object|null>} */
export async function tabsCreate(opts) {
  const chrome = getChrome();
  if (!chrome?.tabs?.create) return null;
  try { return await chrome.tabs.create(opts); } catch { return null; }
}

/** @param {Function} fn */
export function addRuntimeOnInstalledListener(fn) {
  const chrome = getChrome();
  chrome?.runtime?.onInstalled?.addListener(fn);
}

/** @param {Function} fn */
export function addRuntimeOnStartupListener(fn) {
  const chrome = getChrome();
  chrome?.runtime?.onStartup?.addListener(fn);
}

/** @param {Function} fn */
export function addRuntimeOnMessageListener(fn) {
  const chrome = getChrome();
  chrome?.runtime?.onMessage?.addListener(fn);
}

/** @returns {void} */
export function runtimeOpenOptionsPage() {
  const chrome = getChrome();
  chrome?.runtime?.openOptionsPage?.();
}

/** @returns {Object|null} */
export function getRuntimeLastError() {
  const chrome = getChrome();
  return chrome?.runtime?.lastError || null;
}

/** @param {Function} fn */
export function addActionOnClickedListener(fn) {
  const chrome = getChrome();
  chrome?.action?.onClicked?.addListener(fn);
}

/** @param {Function=} cb */
export function contextMenusRemoveAll(cb) {
  const chrome = getChrome();
  chrome?.contextMenus?.removeAll?.(cb);
}

/** @param {Object} opts */
export function contextMenusCreate(opts) {
  const chrome = getChrome();
  chrome?.contextMenus?.create?.(opts);
}

/** @param {Function} fn */
export function addContextMenusOnClickedListener(fn) {
  const chrome = getChrome();
  chrome?.contextMenus?.onClicked?.addListener(fn);
}

/** @param {Object} opts @returns {Promise<Array>} */
export async function scriptingExecuteScript(opts) {
  const chrome = getChrome();
  if (!chrome?.scripting?.executeScript) return [];
  try { return await chrome.scripting.executeScript(opts); } catch { return []; }
}

/** @returns {Promise<boolean>} */
export function isFileSchemeAllowed() {
  const chrome = getChrome();
  return new Promise(resolve => {
    if (!chrome?.extension?.isAllowedFileSchemeAccess) return resolve(false);
    chrome.extension.isAllowedFileSchemeAccess(allowed => resolve(!!allowed));
  });
}

/** @param {Function} fn */
export function addTabsOnUpdatedListener(fn) {
  const chrome = getChrome();
  chrome?.tabs?.onUpdated?.addListener(fn);
}

/** @param {Function} fn */
export function addTabsOnRemovedListener(fn) {
  const chrome = getChrome();
  chrome?.tabs?.onRemoved?.addListener(fn);
}
