// Download Media Tabs — MV3 service worker (ES module)
// Parallelized, strict detection, post-download tab closing (window safeguard),
// and Filters (media types, dimensions, file size, domain, extension, MIME, URL).
// Filters are applied ONLY when settings.filtersEnabled === true.

//////////////////////////////
// Settings (storage schema) //
//////////////////////////////
const DEFAULT_SETTINGS = {
  // Media types — always applied
  includeImages: true,
  includeVideo: true,
  includeAudio: true,
  includePdf: true,

  // Scope & naming
  scope: "currentWindow", // "currentWindow" | "allWindows"
  filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",

  // After download
  closeTabAfterDownload: false,
  keepWindowOpenOnLastTabClose: false,

  // Detection
  strictSingleDetection: true,
  coverageThreshold: 0.5,

  // Performance
  probeConcurrency: 8,
  downloadConcurrency: 6,

  // Filters (gated by filtersEnabled)
  filtersEnabled: false,
  filters: {
    // Image dimensions (images only); 0 => no limit
    minWidth: 0,
    minHeight: 0,
    maxWidth: 0,
    maxHeight: 0,
    minMegapixels: 0,
    maxMegapixels: 0,

    // File size (bytes); 0 => no limit
    minBytes: 0,
    maxBytes: 0,

    // Domain allow/deny (suffix match)
    allowedDomains: [],
    blockedDomains: [],

    // Extensions (lowercase, no dot)
    allowedExtensions: [],
    blockedExtensions: [],

    // MIME patterns (lowercase; supports "*" wildcard, e.g., "image/*")
    allowedMime: [],
    blockedMime: [],

    // URL substring include/exclude
    includeUrlSubstrings: [],
    excludeUrlSubstrings: []
  }
};

//////////////////////////////
// MIME / extensions helpers //
//////////////////////////////
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
const IMAGE_EXTENSION_SET = new Set(["jpg","jpeg","jpe","png","gif","webp","bmp","tif","tiff","svg","avif"]);

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

//////////////////////////
// URL & filename utils //
//////////////////////////
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

////////////////////////
// Storage & menus    //
////////////////////////
async function getSettings() {
  return new Promise((resolve) => chrome.storage.sync.get(DEFAULT_SETTINGS, resolve));
}

async function setDefaultContextMenus() {
  chrome.contextMenus.removeAll(() => {
    // Default scopes
    chrome.contextMenus.create({ id: "dmt-current", title: "Download media tabs (current window)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "dmt-all",     title: "Download media tabs (all windows)",    contexts: ["action"] });

    // New scopes relative to active tab
    chrome.contextMenus.create({ id: "dmt-left",    title: "Download media tabs to the LEFT (incl. current)",  contexts: ["action"] });
    chrome.contextMenus.create({ id: "dmt-right",   title: "Download media tabs to the RIGHT (incl. current)", contexts: ["action"] });
    chrome.contextMenus.create({ id: "dmt-group",   title: "Download media tabs in CURRENT TAB GROUP",         contexts: ["action"] });

    chrome.contextMenus.create({ id: "separator-1", type: "separator", contexts: ["action"] });
    chrome.contextMenus.create({ id: "open-options", title: "Options…", contexts: ["action"] });
  });
}
chrome.runtime.onInstalled.addListener(setDefaultContextMenus);
chrome.runtime.onStartup.addListener(setDefaultContextMenus);

chrome.contextMenus.onClicked.addListener(async (info) => {
  switch (info.menuItemId) {
    case "open-options":
      chrome.runtime.openOptionsPage();
      return;
    case "dmt-current":
      await runDownload({ mode: "currentWindow" }); return;
    case "dmt-all":
      await runDownload({ mode: "allWindows" }); return;
    case "dmt-left":
      await runDownload({ mode: "leftOfActive" }); return;
    case "dmt-right":
      await runDownload({ mode: "rightOfActive" }); return;
    case "dmt-group":
      await runDownload({ mode: "currentGroup" }); return;
  }
});
chrome.action.onClicked.addListener(async () => {
  const settings = await getSettings();
  await runDownload({ mode: settings.scope || "currentWindow" });
});

///////////////////////////
// Download state & size //
///////////////////////////
const downloadIdToTabId = new Map();

// Size constraints tracked post-start when HEAD was unavailable / inconclusive.
const pendingSizeConstraints = new Map(); // downloadId -> { minBytes, maxBytes, violated?: boolean }

chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta || typeof delta.id !== "number") return;
  const id = delta.id;

  // Real-time maxBytes enforcement via bytesReceived
  if (pendingSizeConstraints.has(id) && delta.bytesReceived && typeof delta.bytesReceived.current === "number") {
    const { maxBytes } = pendingSizeConstraints.get(id);
    const rec = delta.bytesReceived.current;
    if (maxBytes > 0 && rec > maxBytes) {
      // Exceeded limit: cancel download immediately
      try { await chrome.downloads.cancel(id); } catch {}
      pendingSizeConstraints.delete(id);
      downloadIdToTabId.delete(id);
      return;
    }
  }

  // If totalBytes becomes known mid-flight, enforce both min/max against totalBytes
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
      // Known good; no further size tracking needed
      pendingSizeConstraints.delete(id);
    }
  }

  // On completion, verify minBytes (and maxBytes as a fallback) if we still have constraints
  if (delta.state && delta.state.current === "complete") {
    const tabId = downloadIdToTabId.get(id);
    try {
      if (pendingSizeConstraints.has(id)) {
        const { minBytes, maxBytes } = pendingSizeConstraints.get(id);
        pendingSizeConstraints.delete(id);

        // Query final bytesReceived; if not meeting constraints, remove file and do NOT close tab
        const [item] = await chrome.downloads.search({ id });
        const finalBytes = item && Number.isFinite(item.fileSize) ? item.fileSize
            : (item && Number.isFinite(item.bytesReceived) ? item.bytesReceived : -1);

        const tooSmall = (minBytes > 0 && finalBytes >= 0 && finalBytes < minBytes);
        const tooLarge = (maxBytes > 0 && finalBytes >= 0 && finalBytes > maxBytes);

        if (tooSmall || tooLarge) {
          // Remove the file if possible, then erase from history
          try { await chrome.downloads.removeFile(id); } catch {}
          try { await chrome.downloads.erase({ id }); } catch {}
          downloadIdToTabId.delete(id);
          return; // do not close tab
        }
      }

      // No violations -> optionally close tab
      const settings = await getSettings();
      if (tabId != null && settings.closeTabAfterDownload) {
        await closeTabRespectingWindow(tabId, settings);
      }
    } finally {
      downloadIdToTabId.delete(id);
    }
  }

  // Interrupted/cancelled: cleanup mappings
  if (delta.error || (delta.state && delta.state.current === "interrupted")) {
    pendingSizeConstraints.delete(id);
    downloadIdToTabId.delete(id);
  }
});

//////////////////////////
// Concurrency throttle //
//////////////////////////
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

//////////////////////////////
// Tab selection by new modes
//////////////////////////////
async function selectCandidateTabs(mode) {
  switch (mode) {
    case "allWindows": {
      return chrome.tabs.query({});
    }
    case "leftOfActive":
    case "rightOfActive":
    case "currentGroup":
    case "currentWindow":
    default: {
      const windowTabs = await chrome.tabs.query({ currentWindow: true });
      if (mode === "currentWindow") return windowTabs;

      // Active tab in current window
      const [activeTab] = windowTabs.filter(t => t.active);
      if (!activeTab) return [];

      if (mode === "currentGroup") {
        if (typeof activeTab.groupId === "number" && activeTab.groupId !== -1) {
          return chrome.tabs.query({ currentWindow: true, groupId: activeTab.groupId });
        }
        return []; // no group -> nothing to do
      }

      if (mode === "leftOfActive") {
        return windowTabs.filter(t => t.index <= activeTab.index);
      }
      if (mode === "rightOfActive") {
        return windowTabs.filter(t => t.index >= activeTab.index);
      }
      return windowTabs;
    }
  }
}

//////////////////////
// Main orchestration
//////////////////////
async function runDownload({ mode }) {
  const settings = await getSettings();

  // Step 0: pick tabs per mode
  const allTabs = await selectCandidateTabs(mode || "currentWindow");

  // Supported schemes only
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

  const batchDate = new Date();

  // 1) Decide per tab in parallel
  const limitProbe = pLimit(Math.max(1, settings.probeConcurrency | 0));
  const decisions = await Promise.allSettled(
      candidateTabs.map(tab => limitProbe(() => decideTab(tab, settings)))
  );

  // 2) Build download plans and apply filters when enabled
  const seenUrl = new Map(); // url -> tabId
  const plans = [];

  const filtersOn = !!settings.filtersEnabled;               // <<— single master toggle
  const f = Object.assign({}, DEFAULT_SETTINGS.filters, settings.filters || {});
  const hasSizeRule = filtersOn && (f.minBytes > 0 || f.maxBytes > 0);

  for (let i = 0; i < decisions.length; i++) {
    const res = decisions[i];
    if (res.status !== "fulfilled" || !res.value || !res.value.shouldDownload) continue;

    const tab = candidateTabs[i];
    const { downloadUrl, suggestedExt, baseName, mimeFromProbe, imageWidth, imageHeight } = res.value;
    if (!downloadUrl) continue;
    if (seenUrl.has(downloadUrl)) continue;
    seenUrl.set(downloadUrl, tab.id);

    const ext = (suggestedExt || extFromUrl(downloadUrl) || "bin").toLowerCase();
    const host = hostFromUrl(downloadUrl);
    const mime = (mimeFromProbe && String(mimeFromProbe).toLowerCase()) ||
        MEDIA_EXTENSIONS.get(ext) || "";

    // Media types (always applied)
    if (!isMimeIncluded(mime || (MEDIA_EXTENSIONS.get(ext) || ""), settings)) continue;

    // Filters (if enabled)
    if (filtersOn) {
      const preVerdict = applyPreFilters({
        url: downloadUrl,
        host,
        ext,
        mime,
        width: imageWidth,
        height: imageHeight
      }, f);
      if (!preVerdict.pass) continue;
    }

    plans.push({
      tabId: tab.id,
      url: downloadUrl,
      host,
      ext,
      mime,
      baseName,
      width: imageWidth,
      height: imageHeight,
      // size handling decided later
    });
  }

  if (!plans.length) {
    console.log("[Download Media Tabs] Nothing to download after filtering.");
    return;
  }

  // 3) HEAD for size constraints (if enabled and rules exist)
  if (hasSizeRule) {
    const limitHead = pLimit(Math.max(1, settings.probeConcurrency | 0));
    const headResults = await Promise.allSettled(plans.map(p => limitHead(async () => {
      const bytes = await headContentLength(p.url, 5000);
      if (bytes == null || bytes < 0) return { known: false, ok: true };
      const ok = sizeWithin(bytes, f.minBytes, f.maxBytes);
      return { known: true, ok, bytes };
    })));

    const filtered = [];
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      const r = headResults[i];
      if (r.status !== "fulfilled") {
        // HEAD failed; enforce after start via bytesReceived
        plan.postSizeEnforce = true;
        filtered.push(plan);
        continue;
      }
      const { known, ok } = r.value;
      if (known) {
        if (!ok) continue;        // reject now
        filtered.push(plan);      // OK, no post-start enforcement needed
      } else {
        plan.postSizeEnforce = true;
        filtered.push(plan);
      }
    }
    plans.length = 0;
    plans.push(...filtered);
  }

  if (!plans.length) {
    console.log("[Download Media Tabs] Nothing to download after size checks.");
    return;
  }

  // 4) Start downloads with concurrency
  const limitDl = pLimit(Math.max(1, settings.downloadConcurrency | 0));
  const results = await Promise.allSettled(plans.map(p => limitDl(async () => {
    const filename = buildFilename(settings.filenamePattern, {
      date: batchDate,
      host: p.host,
      basename: p.baseName || (lastPathSegment(p.url) || "file"),
      ext: p.ext
    });
    const downloadId = await chrome.downloads.download({
      url: p.url,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    });
    if (typeof downloadId === "number") {
      downloadIdToTabId.set(downloadId, p.tabId);
      if (hasSizeRule && p.postSizeEnforce) {
        pendingSizeConstraints.set(downloadId, { minBytes: f.minBytes, maxBytes: f.maxBytes });
      }
    }
  })));

  const ok = results.filter(r => r.status === "fulfilled").length;
  const fail = results.length - ok;
  console.log(`[Download Media Tabs] Started ${ok} download(s), ${fail} failed to start.`);
}

/////////////////////////////
// Decision logic (w/ dims) //
/////////////////////////////
async function decideTab(tab, settings) {
  const url = tab.url || "";

  // If filters are disabled, we only probe when necessary for detection.
  // If filters are enabled and any dimension rule is active, we attempt to fetch dimensions for images.
  const f = Object.assign({}, DEFAULT_SETTINGS.filters, settings.filters || {});
  const needDims = !!settings.filtersEnabled && hasActiveDimensionRules(f);

  // Quick pass via URL extension — but still probe for dimensions when required
  const ext = extFromUrl(url);
  if (ext && MEDIA_EXTENSION_SET.has(ext)) {
    const mime = MEDIA_EXTENSIONS.get(ext);
    if (isMimeIncluded(mime, settings)) {
      if (!needDims) {
        return {
          shouldDownload: true,
          downloadUrl: url,
          suggestedExt: ext,
          baseName: lastPathSegment(url),
          mimeFromProbe: mime,
          imageWidth: undefined,
          imageHeight: undefined
        };
      }
      // Need dimensions for image filters -> probe anyway
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: probeDocument,
          args: [!!settings.strictSingleDetection, Number(settings.coverageThreshold) || 0.5]
        });
        if (result && (result.single || /^(image)\//i.test(result.contentType))) {
          const chosen = absolutePrefer(result.src, result.href);
          return {
            shouldDownload: true,
            downloadUrl: chosen,
            suggestedExt: ext,
            baseName: lastPathSegment(chosen) || lastPathSegment(url) || "file",
            mimeFromProbe: result.contentType || mime,
            imageWidth: result.imageWidth,
            imageHeight: result.imageHeight
          };
        }
      } catch { /* ignore */ }
      // Probe failed; proceed without dims (filters will reject if dims required and unknown)
      return {
        shouldDownload: true,
        downloadUrl: url,
        suggestedExt: ext,
        baseName: lastPathSegment(url),
        mimeFromProbe: mime,
        imageWidth: undefined,
        imageHeight: undefined
      };
    }
  }

  // Probe the DOM (best-effort) for all other cases
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: probeDocument,
      args: [!!settings.strictSingleDetection, Number(settings.coverageThreshold) || 0.5]
    });

    if (!result) return { shouldDownload: false };

    const { contentType, href, protocol, single, src, looksLikePdf, imageWidth, imageHeight } = result;

    if (protocol === "blob:") return { shouldDownload: false };

    if (isMimeIncluded(contentType, settings)) {
      const chosen = absolutePrefer(src, href);
      return {
        shouldDownload: true,
        downloadUrl: chosen,
        suggestedExt: extensionSuggestForMime(contentType),
        baseName: lastPathSegment(chosen) || "file",
        mimeFromProbe: contentType,
        imageWidth,
        imageHeight
      };
    }

    if (single || looksLikePdf) {
      const chosen = absolutePrefer(src, href);
      const inferExt = extFromUrl(chosen) || (looksLikePdf ? "pdf" : null);
      return {
        shouldDownload: true,
        downloadUrl: chosen,
        suggestedExt: inferExt || undefined,
        baseName: lastPathSegment(chosen) || "file",
        mimeFromProbe: contentType || (inferExt ? MEDIA_EXTENSIONS.get(inferExt) : ""),
        imageWidth,
        imageHeight
      };
    }
  } catch { /* ignore */ }

  return { shouldDownload: false };
}

function hasActiveDimensionRules(f) {
  return !!(f &&
      (f.minWidth > 0 || f.minHeight > 0 || f.maxWidth > 0 || f.maxHeight > 0 ||
          f.minMegapixels > 0 || f.maxMegapixels > 0));
}

function absolutePrefer(src, href) {
  try { if (src) return new URL(src, href).toString(); } catch {}
  return href;
}

///////////////////////////////
// Page probe (strict + dims) //
///////////////////////////////
function probeDocument(strict = true, coverageThreshold = 0.5) {
  const out = {
    contentType: (document && document.contentType) || "",
    href: location.href,
    protocol: location.protocol,
    single: false,
    src: "",
    looksLikePdf: false,
    imageWidth: undefined,
    imageHeight: undefined
  };

  // Fast positive: top-level image/video/audio/PDF docs
  if (/^(image|video|audio)\//i.test(out.contentType)) {
    out.single = true;
    const img = document.querySelector("img");
    const vid = document.querySelector("video");
    const aud = document.querySelector("audio");
    if (img) {
      const nw = Number(img.naturalWidth) || 0;
      const nh = Number(img.naturalHeight) || 0;
      out.src = img.currentSrc || img.src || "";
      out.imageWidth  = nw > 0 ? nw : undefined;
      out.imageHeight = nh > 0 ? nh : undefined;
    } else if (vid) {
      const src = vid.currentSrc || (vid.querySelector("source") && vid.querySelector("source").src) || "";
      out.src = src;
    } else if (aud) {
      const src = aud.currentSrc || (aud.querySelector("source") && aud.querySelector("source").src) || "";
      out.src = src;
    }
    return out;
  }
  if (out.contentType === "application/pdf") {
    out.single = true;
    out.looksLikePdf = true;
    const emb = document.querySelector("embed, object");
    out.src = (emb && (emb.getAttribute("src") || "")) || "";
    return out;
  }

  // Strict structural + coverage heuristic
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
      const bodyDirect = mediaElems.filter(el => el.parentElement === document.body);
      if (mediaElems.length === 1 && bodyDirect.length === 1) {
        const el = bodyDirect[0];
        out.single = true;
        out.looksLikePdf = el.tagName !== "IMG" && isPdfEmbed(el);
        out.src = srcFromMedia(el);
        if (el.tagName === "IMG") {
          const nw = Number(el.naturalWidth) || 0;
          const nh = Number(el.naturalHeight) || 0;
          out.imageWidth  = nw > 0 ? nw : undefined;
          out.imageHeight = nh > 0 ? nh : undefined;
        }
      }
      return out;
    }

    if (mediaElems.length !== 1) return out;
    const el = mediaElems[0];
    if (el.parentElement !== document.body) return out;

    // Viewport coverage
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
    if (el.tagName === "IMG") {
      const nw = Number(el.naturalWidth) || 0;
      const nh = Number(el.naturalHeight) || 0;
      out.imageWidth  = nw > 0 ? nw : undefined;
      out.imageHeight = nh > 0 ? nh : undefined;
    }
  } catch {}
  return out;

  function srcFromMedia(el) {
    if (!el) return "";
    if (el.tagName === "IMG")   return el.currentSrc || el.src || "";
    if (el.tagName === "VIDEO") return el.currentSrc || (el.querySelector("source") && el.querySelector("source").src) || "";
    if (el.tagName === "AUDIO") return el.currentSrc || (el.querySelector("source") && el.querySelector("source").src) || "";
    if (el.tagName === "EMBED" || el.tagName === "OBJECT") {
      return el.getAttribute("data") || el.getAttribute("src") || "";
    }
    return "";
  }
}

/////////////
// Filters //
/////////////
function applyPreFilters(meta, f) {
  // meta: { url, host, ext, mime, width?, height? }
  const url = String(meta.url || "");
  const host = String(meta.host || "").toLowerCase();
  const ext = String(meta.ext || "").toLowerCase();
  const mime = String(meta.mime || "").toLowerCase();

  // Normalize dimensions: treat <= 0 as unknown
  const width  = Number.isFinite(meta.width)  && meta.width  > 0 ? Number(meta.width)  : undefined;
  const height = Number.isFinite(meta.height) && meta.height > 0 ? Number(meta.height) : undefined;

  // URL substrings (exclude first)
  if (hasAnySubstring(url, f.excludeUrlSubstrings)) return { pass: false };
  if (Array.isArray(f.includeUrlSubstrings) && f.includeUrlSubstrings.length > 0) {
    if (!hasAnySubstring(url, f.includeUrlSubstrings)) return { pass: false };
  }

  // Domain block/allow (block wins)
  if (suffixMatchesAny(host, f.blockedDomains)) return { pass: false };
  if (Array.isArray(f.allowedDomains) && f.allowedDomains.length > 0) {
    if (!suffixMatchesAny(host, f.allowedDomains)) return { pass: false };
  }

  // Extension block/allow
  if (inList(ext, f.blockedExtensions)) return { pass: false };
  if (Array.isArray(f.allowedExtensions) && f.allowedExtensions.length > 0) {
    if (!inList(ext, f.allowedExtensions)) return { pass: false };
  }

  // MIME block/allow
  if (mimeMatchesAny(mime, f.blockedMime)) return { pass: false };
  if (Array.isArray(f.allowedMime) && f.allowedMime.length > 0) {
    if (!mimeMatchesAny(mime, f.allowedMime)) return { pass: false };
  }

  // Image dimensions apply only to images and only when filters are enabled (caller ensures that)
  const isImage = (mime.startsWith("image/") || IMAGE_EXTENSION_SET.has(ext));
  if (isImage) {
    const hasWRule  = (f.minWidth > 0 || f.maxWidth > 0);
    const hasHRule  = (f.minHeight > 0 || f.maxHeight > 0);
    const hasMPRule = (f.minMegapixels > 0 || f.maxMegapixels > 0);

    if (hasWRule) {
      if (width == null) return { pass: false };
      if (f.minWidth > 0 && width < f.minWidth) return { pass: false };
      if (f.maxWidth > 0 && width > f.maxWidth) return { pass: false };
    }
    if (hasHRule) {
      if (height == null) return { pass: false };
      if (f.minHeight > 0 && height < f.minHeight) return { pass: false };
      if (f.maxHeight > 0 && height > f.maxHeight) return { pass: false };
    }
    if (hasMPRule) {
      if (width == null || height == null) return { pass: false };
      const mp = (width * height) / 1e6;
      if (f.minMegapixels > 0 && mp < f.minMegapixels) return { pass: false };
      if (f.maxMegapixels > 0 && mp > f.maxMegapixels) return { pass: false };
    }
  }

  return { pass: true };
}

function hasAnySubstring(s, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  for (const sub of arr) {
    const t = String(sub || "");
    if (!t) continue;
    if (s.includes(t)) return true;
  }
  return false;
}
function suffixMatchesAny(host, suffixes) {
  if (!host) return false;
  if (!Array.isArray(suffixes) || suffixes.length === 0) return false;
  for (const raw of suffixes) {
    const suf = String(raw || "").toLowerCase().replace(/^\.+/, "");
    if (!suf) continue;
    if (host === suf || host.endsWith("." + suf)) return true;
  }
  return false;
}
function inList(val, list) {
  if (!val) return false;
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some(x => String(x || "").toLowerCase() === val);
}
function mimeMatchesAny(mime, patterns) {
  if (!mime) return false;
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  mime = mime.toLowerCase();
  const [mType, mSub] = mime.split("/");
  for (const p of patterns) {
    const pat = String(p || "").toLowerCase().trim();
    if (!pat) continue;
    if (pat === "*") return true;
    const [pType, pSub] = pat.split("/");
    if (!pSub) {
      if (pat === mime) return true;
      continue;
    }
    if (pSub === "*") {
      if (pType === mType) return true;
    } else {
      if (pType === mType && pSub === mSub) return true;
    }
  }
  return false;
}

///////////////////////
// Size/HEAD helpers //
///////////////////////
function sizeWithin(bytes, minBytes, maxBytes) {
  if (minBytes > 0 && bytes < minBytes) return false;
  if (maxBytes > 0 && bytes > maxBytes) return false;
  return true;
}

async function headContentLength(url, timeoutMs = 5000) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));

    const resp = await fetch(url, {
      method: "HEAD",
      cache: "no-cache",
      redirect: "follow",
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!resp.ok) return null;
    const len = resp.headers.get("content-length");
    if (!len) return null;
    const n = parseInt(len, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/////////////////////////////////////
// Window-preservation tab closing //
/////////////////////////////////////
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

    const tabsInWindow = await chrome.tabs.query({ windowId: tab.windowId });
    if (!Array.isArray(tabsInWindow) || tabsInWindow.length <= 1) {
      try {
        await chrome.tabs.create({ windowId: tab.windowId, url: "chrome://newtab/" });
      } catch {}
    }
    chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
  } catch {}
}
