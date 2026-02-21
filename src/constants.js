/** @typedef {import('./types.js').Settings} Settings */

export const MEDIA_EXTENSIONS = new Map([
  ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["jpe", "image/jpeg"],
  ["png", "image/png"], ["gif", "image/gif"], ["webp", "image/webp"],
  ["bmp", "image/bmp"], ["tif", "image/tiff"], ["tiff", "image/tiff"],
  ["svg", "image/svg+xml"], ["avif", "image/avif"],
  ["mp4", "video/mp4"], ["m4v", "video/x-m4v"], ["mov", "video/quicktime"],
  ["webm", "video/webm"], ["mkv", "video/x-matroska"], ["avi", "video/x-msvideo"],
  ["ogv", "video/ogg"],
  ["mp3", "audio/mpeg"], ["m4a", "audio/mp4"], ["aac", "audio/aac"],
  ["flac", "audio/flac"], ["wav", "audio/wav"], ["ogg", "audio/ogg"], ["oga", "audio/ogg"],
  ["pdf", "application/pdf"]
]);
export const MEDIA_EXTENSION_SET = new Set([...MEDIA_EXTENSIONS.keys()]);
export const IMAGE_EXTENSION_SET = new Set(["jpg","jpeg","jpe","png","gif","webp","bmp","tif","tiff","svg","avif"]);

// Constants and MIME/extension helpers
/** @type {Settings} */
export const DEFAULT_SETTINGS = {
  includeImages: true,
  includeVideo: true,
  includeAudio: true,
  includePdf: true,
  scope: "currentWindow",
  filenamePattern: "Media Tabs/{host}/{basename}",
  theme: "system",
  closeTabAfterDownload: false,
  keepWindowOpenOnLastTabClose: false,
  strictSingleDetection: true,
  coverageThreshold: 0.5,
  inferExtensionFromUrl: true,
  inferUrlAllowedExtensions: [...MEDIA_EXTENSION_SET],
  triggerUrlSubstrings: [],
  triggerBypassFilters: false,
  probeConcurrency: 8,
  downloadConcurrency: 6,
  // New behavior: when enabled, auto-run on each new tab as it finishes loading
  autoRunOnNewTabs: false,
  autoRunTiming: "start",
  autoCloseOnStart: false,
  // User-managed whitelist of sites (Chrome match patterns) for which the extension may request access at runtime
  allowedOrigins: [],
  filtersEnabled: false,
  filters: {
    minWidth: 0,
    minHeight: 0,
    maxWidth: 0,
    maxHeight: 0,
    minMegapixels: 0,
    maxMegapixels: 0,
    minBytes: 0,
    maxBytes: 0,
    allowedDomains: [],
    blockedDomains: [],
    allowedExtensions: [],
    blockedExtensions: [],
    allowedMime: [],
    blockedMime: [],
    includeUrlSubstrings: [],
    excludeUrlSubstrings: []
  }
};

export function isMimeIncluded(mime, s) {
  if (!mime || typeof mime !== "string") return false;
  mime = mime.toLowerCase();
  if (s.includeImages && mime.startsWith("image/")) return true;
  if (s.includeVideo && mime.startsWith("video/")) return true;
  if (s.includeAudio && mime.startsWith("audio/")) return true;
  if (s.includePdf && mime === "application/pdf") return true;
  return false;
}

export function extensionSuggestForMime(mime) {
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
