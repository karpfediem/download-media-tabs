export function ref(value) {
  return { current: value };
}

export function createStorageFixture({ sync = {}, local = {}, session = {} } = {}) {
  const storage = {
    sync: { ...sync },
    local: { ...local },
    session: { ...session }
  };

  function getFromStore(area, defaults) {
    const base = (defaults && typeof defaults === "object") ? defaults : {};
    const data = storage[area] || {};
    return { ...base, ...data };
  }

  function makeArea(area) {
    return {
      get: (defaults, cb) => {
        const data = getFromStore(area, defaults);
        if (typeof cb === "function") return cb(data);
        return Promise.resolve(data);
      },
      set: async (obj) => {
        storage[area] = { ...(storage[area] || {}), ...(obj || {}) };
      }
    };
  }

  function makeChromeStorage({ onChangedListeners } = {}) {
    const api = {
      sync: makeArea("sync"),
      local: makeArea("local"),
      session: makeArea("session")
    };
    if (onChangedListeners) {
      api.onChanged = {
        addListener: (fn) => { onChangedListeners.push(fn); }
      };
    }
    return api;
  }

  return { storage, getFromStore, makeChromeStorage };
}

export function createDownloadsStub({
  onChangedListenerRef,
  downloadCalls,
  nextDownloadIdRef,
  searchResults,
  cancelCalls,
  removeFileCalls,
  eraseCalls,
  globalListenerKey = "__dmtOnChangedListener"
} = {}) {
  return {
    onChanged: {
      addListener: (fn) => {
        if (onChangedListenerRef) onChangedListenerRef.current = fn;
        if (globalListenerKey) globalThis[globalListenerKey] = fn;
      }
    },
    download: async (opts) => {
      if (downloadCalls) downloadCalls.push(opts);
      if (nextDownloadIdRef) return nextDownloadIdRef.current++;
      return 1;
    },
    search: async ({ id } = {}) => (searchResults ? (searchResults.get(id) || []) : []),
    cancel: async (id) => { if (cancelCalls) cancelCalls.push(id); },
    removeFile: async (id) => { if (removeFileCalls) removeFileCalls.push(id); },
    erase: async (obj) => { if (eraseCalls) eraseCalls.push(obj); }
  };
}

export function createTabsStub({ get, query, remove, create } = {}) {
  return {
    get: get || (async () => null),
    query: query || (async () => []),
    remove: remove || ((_tabId, cb) => { if (typeof cb === "function") cb(); }),
    create: create || (async () => ({ id: 999, url: "chrome://newtab/", windowId: 1 }))
  };
}

export function createAlarmsStub({ onAlarmListeners, createCalls, clearCalls } = {}) {
  return {
    create: (name, info) => {
      if (createCalls) createCalls.push({ name, info });
    },
    clear: (name, cb) => {
      if (clearCalls) clearCalls.push(name);
      if (typeof cb === "function") cb(true);
    },
    onAlarm: {
      addListener: (fn) => { if (onAlarmListeners) onAlarmListeners.push(fn); }
    }
  };
}

export function createChromeBase({
  storageFixture,
  storageOnChangedListeners,
  downloads,
  tabs,
  alarms,
  permissionsOk = false,
  runtimeLastError = null,
  scriptingExecuteScript,
  extensionAllowedFileScheme = false
} = {}) {
  return {
    storage: storageFixture ? storageFixture.makeChromeStorage({ onChangedListeners: storageOnChangedListeners }) : undefined,
    downloads: downloads || createDownloadsStub(),
    tabs: tabs || createTabsStub(),
    alarms: alarms || createAlarmsStub(),
    permissions: {
      contains: (_query, cb) => cb(!!permissionsOk)
    },
    runtime: {
      lastError: runtimeLastError
    },
    scripting: {
      executeScript: scriptingExecuteScript || (async () => [{ result: null }])
    },
    extension: {
      isAllowedFileSchemeAccess: (cb) => cb(!!extensionAllowedFileScheme)
    }
  };
}
