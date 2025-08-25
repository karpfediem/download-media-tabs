import { IMAGE_EXTENSION_SET } from './constants.js';

export function applyPreFilters(meta, f) {
  const url = String(meta.url || "");
  const host = String(meta.host || "").toLowerCase();
  const ext = String(meta.ext || "").toLowerCase();
  const mime = String(meta.mime || "").toLowerCase();

  const width  = Number.isFinite(meta.width)  && meta.width  > 0 ? Number(meta.width)  : undefined;
  const height = Number.isFinite(meta.height) && meta.height > 0 ? Number(meta.height) : undefined;

  if (hasAnySubstring(url, f.excludeUrlSubstrings)) return { pass: false };
  if (Array.isArray(f.includeUrlSubstrings) && f.includeUrlSubstrings.length > 0) {
    if (!hasAnySubstring(url, f.includeUrlSubstrings)) return { pass: false };
  }

  if (suffixMatchesAny(host, f.blockedDomains)) return { pass: false };
  if (Array.isArray(f.allowedDomains) && f.allowedDomains.length > 0) {
    if (!suffixMatchesAny(host, f.allowedDomains)) return { pass: false };
  }

  if (inList(ext, f.blockedExtensions)) return { pass: false };
  if (Array.isArray(f.allowedExtensions) && f.allowedExtensions.length > 0) {
    if (!inList(ext, f.allowedExtensions)) return { pass: false };
  }

  if (mimeMatchesAny(mime, f.blockedMime)) return { pass: false };
  if (Array.isArray(f.allowedMime) && f.allowedMime.length > 0) {
    if (!mimeMatchesAny(mime, f.allowedMime)) return { pass: false };
  }

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

export function hasActiveDimensionRules(f) {
  return !!(f && (f.minWidth > 0 || f.minHeight > 0 || f.maxWidth > 0 || f.maxHeight > 0 || f.minMegapixels > 0 || f.maxMegapixels > 0));
}

export function hasAnySubstring(s, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  for (const sub of arr) {
    const t = String(sub || "");
    if (!t) continue;
    if (s.includes(t)) return true;
  }
  return false;
}

export function suffixMatchesAny(host, suffixes) {
  if (!host) return false;
  if (!Array.isArray(suffixes) || suffixes.length === 0) return false;
  for (const raw of suffixes) {
    const suf = String(raw || "").toLowerCase().replace(/^\.+/, "");
    if (!suf) continue;
    if (host === suf || host.endsWith("." + suf)) return true;
  }
  return false;
}

export function inList(val, list) {
  if (!val) return false;
  if (!Array.isArray(list) || list.length === 0) return false;
  return list.some(x => String(x || "").toLowerCase() === val);
}

export function mimeMatchesAny(mime, patterns) {
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
