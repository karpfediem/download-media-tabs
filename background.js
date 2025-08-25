// Download Media Tabs — background service worker (MV3) with parallelism, strict detection,
// and keep-window-open safeguard when closing the last tab.

const DEFAULT_SETTINGS = {
  includeImages: true,
  includeVideo: true,
  includeAudio: true,
  includePdf: true,
  scope: "currentWindow", // "currentWindow" | "allWindows"
  filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",
  closeTabAfterDownload: false,
  probeConcurrency: 8,
  downloadConcurrency: 6,
  strictSingleDetection: true,
  coverageThreshold: 0.5,
  keepWindowOpenOnLastTabClose: false
};

const MEDIA_EXTENSIONS = new Map([
  // images
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["jpe", "image/jpeg"],
  ["png", "image/png"], ["gif", "image/gif"], ["webp", "image/webp"],
  ["bmp", "image/bmp"], ["tif", "image/tiff"], ["tiff", "image/tiff"],
  ["svg", "image/svg+xml"], ["avif", "image/avif"],
  // video
  ["mp4", "video/mp4"], ["m4v", "video/x-m4v"], ["mov", "video/quicktime"],
  ["webm", "video/webm"], ["mkv", "video/x-matroska"], ["avi", "video/x-msvideo"],
  ["ogv", "video/ogg"],
  // audio
  ["mp3", "audio/mpeg"], ["m4a", "audio/mp4"], ["aac", "audio/aac"],
  ["flac", "audio/flac"], ["wav", "audio/wav"], ["ogg", "audio/ogg"], ["oga", "audio/ogg"],
  // documents
  ["pdf", "application/pdf"]
]);

const MEDIA_EXTENSION_SET = new Set([...MEDIA_EXTENSIONS.keys()]);

function isMimeIncluded(mime, s) {
  if (!mime || typeof mime !== "string") return false;
  mime = mime.toLowerCase();
  if (s.includeImages && mime.startsWith("image/")) return true;
  if (s.includeVideo && mime.startsWith("video/")) return true;
  if (s.includeAudio && mime.startsWith("audio/")) return true;
  if (s.includePdf && mime === "application/pdf") return true;
  return false;
}

function extensionSuggestForMime(mime) {
  if (!mime) return null;
  mime = mime.toLowerCase();
  if (mime.startsWith("image/")) {
    if (mime === "image/jpeg") return "jpg";
    if (mime === "image/svg+xml") return "svg";
    if (mime === "image/webp") return "webp";
    if (mime === "image/avif") return "avif";
    if (mime === "image/gif") return "gif";
    if (mime === "image/png") return "png";
  }
  if (mime.startsWith("video/")) {
    if (mime === "video/mp4") return "mp4";
    if (mime === "video/webm") return "webm";
    if (mime === "video/quicktime") return "mov";
    if (mime.includes("matroska")) return "mkv";
  }
  if (mime.startsWith("audio/")) {
    if (mime === "audio/mpeg") return "mp3";
    if (mime === "audio/mp4") return "m4a";
    if (mime === "audio/flac") return "flac";
    if (mime === "audio/ogg") return "ogg";
    if (mime === "audio/wav") return "wav";
  }
  if (mime === "application/pdf") return "pdf";
  return null;
}

function sanitizeForPath(s) {
  return s.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 180);
}

function yyyymmddHHMMss(date = new Date()) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function lastPathSegment(u) {
  try {
    const url = new URL(u);
    const p = url.pathname;
    if (!p || p === "/") return null;
    const seg = p.split("/").pop();
    return seg || null;
  } catch {
    return null;
  }
}

function extFromUrl(u) {
  const seg = lastPathSegment(u);
  if (!seg) return null;
  const m = /\.([A-Za-z0-9]+)$/.exec(seg.split("?")[0].split("#")[0]);
  return m ? m[1].toLowerCase() : null;
}

function hostFromUrl(u) {
  try { return new URL(u).host || "unknown-host"; } catch { return "unknown-host"; }
}

function buildFilename(pattern, ctx) {
  const stamp = yyyymmddHHMMss(ctx.date);
  let out = pattern;
  out = out.replaceAll("{YYYYMMDD-HHmmss}", stamp);
  out = out.replaceAll("{host}", sanitizeForPath(ctx.host));
  out = out.replaceAll("{basename}", sanitizeForPath(ctx.basename || "file"));
  if (ctx.ext && !/\.[A-Za-z0-9]{1,8}$/.test(out)) out += `.${ctx.ext}`;
  return out;
}

async function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
}

async function setDefaultContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "download-media-tabs-current", title: "Download media tabs (current window)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "download-media-tabs-all", title: "Download media tabs (all windows)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "separator-1", type: "separator", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-options", title: "Options…", contexts: ["action"] });
  });
}

chrome.runtime.onInstalled.addListener(setDefaultContextMenus);
chrome.runtime.onStartup.addListener(setDefaultContextMenus);

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "open-options") {
    chrome.runtime.openOptionsPage();
    return;
  }
  const scope = info.menuItemId === "download-media-tabs-all" ? "allWindows" : "currentWindow";
  await runDownload(scope);
});

chrome.action.onClicked.addListener(async () => {
  const settings = await getSettings();
  await runDownload(settings.scope || "currentWindow");
});

// Track downloads we initiated to close corresponding tabs
const downloadIdToTabId = new Map();

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta || typeof delta.id !== "number") return;
  const tabId = downloadIdToTabId.get(delta.id);
  if (tabId == null) return;

  if (delta.state && delta.state.current === "complete") {
    try {
      const settings = await getSettings();
      if (settings.closeTabAfterDownload) {
        await closeTabRespectingWindow(tabId, settings);
      }
    } finally {
      downloadIdToTabId.delete(delta.id);
    }
  }

  if (delta.error || (delta.state && delta.state.current === "interrupted")) {
    downloadIdToTabId.delete(delta.id);
  }
});

// ---------- Parallelization ----------

function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    active--;
    if (queue.length) {
      const { fn, resolve, reject } = queue.shift();
      run(fn).then(resolve, reject);
    }
  };
  const run = async (fn) => {
    active++;
    try { return await fn(); } finally { next(); }
  };
  return (fn) => new Promise((resolve, reject) => {
    if (active < concurrency) run(fn).then(resolve, reject);
    else queue.push({ fn, resolve, reject });
  });
}

async function runDownload(scope) {
  const settings = await getSettings();
  const allTabs = await chrome.tabs.query(scope === "allWindows" ? {} : { currentWindow: true });

  const candidateTabs = allTabs.filter(t => {
    try {
      const u = new URL(t.url || "");
      return ["http:", "https:", "file:", "ftp:", "data:"].includes(u.protocol);
    } catch { return false; }
  });

  if (candidateTabs.length === 0) {
    console.log("[Download Media Tabs] No candidate tabs.");
    return;
  }

  const stampDate = new Date();
  const limitProbe = pLimit(Math.max(1, settings.probeConcurrency | 0));
  const decisions = await Promise.allSettled(
      candidateTabs.map(tab => limitProbe(() => decideTab(tab, settings)))
  );

  const seenUrl = new Map();
  const tasks = [];
  for (let i = 0; i < decisions.length; i++) {
    const res = decisions[i];
    if (res.status !== "fulfilled" || !res.value || !res.value.shouldDownload) continue;

    const tab = candidateTabs[i];
    const { downloadUrl, suggestedExt, baseName } = res.value;

    if (!downloadUrl) continue;
    if (seenUrl.has(downloadUrl)) continue;
    seenUrl.set(downloadUrl, tab.id);

    const host = hostFromUrl(downloadUrl);
    const ext = suggestedExt || extFromUrl(downloadUrl) || "bin";
    const filename = buildFilename(settings.filenamePattern, {
      date: stampDate,
      host,
      basename: baseName || (lastPathSegment(downloadUrl) || "file"),
      ext
    });

    tasks.push({ tabId: tab.id, url: downloadUrl, filename });
  }

  if (!tasks.length) {
    console.log("[Download Media Tabs] Nothing to download after probing.");
    return;
  }

  const limitDl = pLimit(Math.max(1, settings.downloadConcurrency | 0));
  const results = await Promise.allSettled(tasks.map(t => limitDl(async () => {
    const downloadId = await chrome.downloads.download({
      url: t.url,
      filename: t.filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    if (typeof downloadId === "number") {
      downloadIdToTabId.set(downloadId, t.tabId);
    }
  })));

  const ok = results.filter(r => r.status === "fulfilled").length;
  const fail = results.length - ok;
  console.log(`[Download Media Tabs] Started ${ok} download(s), ${fail} failed to start.`);
}

// ---------- Decision logic ----------

async function decideTab(tab, settings) {
  const url = tab.url || "";

  // 1) URL extension quick-pass
  const ext = extFromUrl(url);
  if (ext && MEDIA_EXTENSION_SET.has(ext)) {
    const mime = MEDIA_EXTENSIONS.get(ext);
    if (isMimeIncluded(mime, settings)) {
      return {
        shouldDownload: true,
        downloadUrl: url,
        suggestedExt: ext,
        baseName: lastPathSegment(url)
      };
    }
  }

  // 2) Probe the tab’s DOM
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: probeDocument,
      args: [!!settings.strictSingleDetection, Number(settings.coverageThreshold) || 0.5]
    });

    if (!result) return { shouldDownload: false };

    const { contentType, href, protocol, single, src, looksLikePdf } = result;

    if (protocol === "blob:") return { shouldDownload: false };

    if (isMimeIncluded(contentType, settings)) {
      const chosen = absolutePrefer(src, href);
      return {
        shouldDownload: true,
        downloadUrl: chosen,
        suggestedExt: extensionSuggestForMime(contentType),
        baseName: lastPathSegment(chosen) || "file"
      };
    }

    if (single || looksLikePdf) {
      const chosen = absolutePrefer(src, href);
      const inferExt = extFromUrl(chosen) || (looksLikePdf ? "pdf" : null);
      return {
        shouldDownload: true,
        downloadUrl: chosen,
        suggestedExt: inferExt || undefined,
        baseName: lastPathSegment(chosen) || "file"
      };
    }
  } catch {
    // Ignore restricted pages or injection failures
  }

  return { shouldDownload: false };
}

function absolutePrefer(src, href) {
  try { if (src) return new URL(src, href).toString(); } catch {}
  return href;
}

// Executed in the page
function probeDocument(strict = true, coverageThreshold = 0.5) {
  const out = {
    contentType: (document && document.contentType) || "",
    href: location.href,
    protocol: location.protocol,
    single: false,
    src: "",
    looksLikePdf: false
  };

  // Fast positive: top-level image/video/audio/PDF documents
  if (/^(image|video|audio)\//i.test(out.contentType)) {
    out.single = true;
    const img = document.querySelector("img");
    const vid = document.querySelector("video");
    const aud = document.querySelector("audio");
    out.src = (img && (img.currentSrc || img.src)) ||
        (vid && (vid.currentSrc || (vid.querySelector("source") && vid.querySelector("source").src) || "")) ||
        (aud && (aud.currentSrc || (aud.querySelector("source") && aud.querySelector("source").src) || "")) ||
        "";
    return out;
  }
  if (out.contentType === "application/pdf") {
    out.single = true;
    out.looksLikePdf = true;
    const emb = document.querySelector("embed, object");
    out.src = (emb && (emb.getAttribute("src") || "")) || "";
    return out;
  }

  try {
    const mediaSelector = "img, video, audio, embed, object";
    const mediaElems = Array.from(document.querySelectorAll(mediaSelector));
    if (!mediaElems.length) return out;

    const isPdfEmbed = (el) => {
      const type = (el.getAttribute("type") || "").toLowerCase();
      const src = (el.getAttribute("src") || "");
      return type.includes("pdf") || /\.pdf(?:[#?].*)?$/i.test(src);
    };

    if (!strict) {
      const bodyDirectMedia = mediaElems.filter(el => el.parentElement === document.body);
      if (mediaElems.length === 1 && bodyDirectMedia.length === 1) {
        out.single = true;
        out.looksLikePdf = bodyDirectMedia[0].tagName !== "IMG" && isPdfEmbed(bodyDirectMedia[0]);
        out.src = srcFromMedia(bodyDirectMedia[0]);
      }
      return out;
    }

    if (mediaElems.length !== 1) return out;
    const el = mediaElems[0];
    if (el.parentElement !== document.body) return out;

    const vpW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const vpH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const vpArea = vpW * vpH;

    let coverage = 0;
    try {
      const r = el.getBoundingClientRect();
      const visW = Math.max(0, Math.min(r.width, vpW));
      const visH = Math.max(0, Math.min(r.height, vpH));
      coverage = (visW * visH) / vpArea;
    } catch {}

    if (coverage < Math.max(0, Math.min(1, coverageThreshold))) return out;

    out.single = true;
    out.looksLikePdf = (el.tagName !== "IMG") && isPdfEmbed(el);
    out.src = srcFromMedia(el);
  } catch {}
  return out;

  function srcFromMedia(el) {
    if (!el) return "";
    if (el.tagName === "IMG") return el.currentSrc || el.src || "";
    if (el.tagName === "VIDEO") {
      return el.currentSrc || (el.querySelector("source") && el.querySelector("source").src) || "";
    }
    if (el.tagName === "AUDIO") {
      return el.currentSrc || (el.querySelector("source") && el.querySelector("source").src) || "";
    }
    if (el.tagName === "EMBED" || el.tagName === "OBJECT") {
      return el.getAttribute("src") || "";
    }
    return "";
  }
}

// ---------- Window-preservation close ----------

async function closeTabRespectingWindow(tabId, settings) {
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

    // Count tabs in the same window *at the time of closure*.
    const tabsInWindow = await chrome.tabs.query({ windowId: tab.windowId });
    if (!Array.isArray(tabsInWindow) || tabsInWindow.length <= 1) {
      // This tab is (likely) the last one: open a newtab first.
      try {
        await chrome.tabs.create({ windowId: tab.windowId, url: "chrome://newtab/" });
      } catch {
        // Creating new tab may fail in some special windows; proceed to remove anyway.
      }
    }

    chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
  } catch {
    // If we cannot get the tab (already closed, etc.), nothing to do.
  }
}
