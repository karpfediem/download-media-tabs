// Download Media Tabs — background service worker (MV3)

const DEFAULT_SETTINGS = {
  includeImages: true,
  includeVideo: true,
  includeAudio: true,
  includePdf: true,
  scope: "currentWindow", // "currentWindow" | "allWindows"
  filenamePattern: "Media Tabs/{YYYYMMDD-HHmmss}/{host}/{basename}",
  closeTabAfterDownload: false // NEW
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

  // Close only when the specific download completes successfully
  if (delta.state && delta.state.current === "complete") {
    try {
      const settings = await getSettings();
      if (settings.closeTabAfterDownload) {
        // Make sure tab still exists; ignore errors if it was closed manually.
        chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
      }
    } finally {
      downloadIdToTabId.delete(delta.id);
    }
  }

  // If the download was interrupted or cancelled, do not close the tab.
  if (delta.error || (delta.state && delta.state.current === "interrupted")) {
    downloadIdToTabId.delete(delta.id);
  }
});

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
  let started = 0;

  for (const tab of candidateTabs) {
    const decision = await decideTab(tab, settings);
    if (!decision.shouldDownload) continue;

    const { downloadUrl, suggestedExt, baseName } = decision;
    const host = hostFromUrl(downloadUrl);
    const ext = suggestedExt || extFromUrl(downloadUrl) || "bin";
    const filename = buildFilename(settings.filenamePattern, {
      date: stampDate,
      host,
      basename: baseName || (lastPathSegment(downloadUrl) || "file"),
      ext
    });

    try {
      const downloadId = await chrome.downloads.download({
        url: downloadUrl,
        filename,
        saveAs: false,              // ensures no dialog IF user setting is off
        conflictAction: "uniquify"
      });
      if (typeof downloadId === "number") {
        downloadIdToTabId.set(downloadId, tab.id);
        started++;
      }
    } catch (e) {
      console.warn(`[Download Media Tabs] Failed to download ${downloadUrl}:`, e);
    }
  }

  console.log(`[Download Media Tabs] Started ${started} download(s).`);
}

async function decideTab(tab, settings) {
  const url = tab.url || "";

  // 1) URL-based quick check
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

  // 2) Probe the tab’s DOM (best-effort)
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: probeDocument
    });

    if (!result) return { shouldDownload: false };

    const { contentType, single, src, href, looksLikePdf, protocol } = result;

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
    // script injection can fail on restricted pages
  }

  return { shouldDownload: false };
}

function absolutePrefer(src, href) {
  try { if (src) return new URL(src, href).toString(); } catch {}
  return href;
}

// Executed in the page
function probeDocument() {
  const out = {
    contentType: (document && document.contentType) || "",
    href: location.href,
    protocol: location.protocol,
    single: false,
    src: "",
    looksLikePdf: false
  };

  try {
    const body = document.body;
    if (body) {
      const oneChild = body.children && body.children.length === 1 ? body.children[0] : null;
      const img = oneChild && oneChild.tagName === "IMG" ? oneChild : document.querySelector("img:only-child");
      const vid = oneChild && oneChild.tagName === "VIDEO" ? oneChild : document.querySelector("video:only-child");
      const aud = oneChild && oneChild.tagName === "AUDIO" ? oneChild : document.querySelector("audio:only-child");
      const embed = oneChild && (oneChild.tagName === "EMBED" || oneChild.tagName === "OBJECT") ? oneChild
          : document.querySelector("embed:only-child, object:only-child");

      if (img || vid || aud) {
        out.single = true;
        out.src = (img && (img.currentSrc || img.src)) ||
            (vid && (vid.currentSrc || (vid.querySelector("source") && vid.querySelector("source").src) || "")) ||
            (aud && (aud.currentSrc || (aud.querySelector("source") && aud.querySelector("source").src) || ""));
      } else if (embed) {
        const type = embed.type ? String(embed.type).toLowerCase() : "";
        const src = embed.getAttribute("src") || "";
        if (type.includes("pdf") || /\.pdf(?:[#?].*)?$/i.test(src) || document.contentType === "application/pdf") {
          out.single = true;
          out.looksLikePdf = true;
          out.src = src || "";
        }
      }
    }

    if (!out.single && /^image\//i.test(out.contentType)) {
      const img = document.querySelector("img");
      if (img) {
        out.single = true;
        out.src = img.currentSrc || img.src || "";
      } else {
        out.single = true;
      }
    }

    if (!out.single && out.contentType === "application/pdf") {
      out.single = true;
      out.looksLikePdf = true;
    }
  } catch {}
  return out;
}
