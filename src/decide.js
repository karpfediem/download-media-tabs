import { MEDIA_EXTENSION_SET, MEDIA_EXTENSIONS, isMimeIncluded, extensionSuggestForMime } from './constants.js';
import { extFromUrl, lastPathSegment, absolutePrefer, inferExtensionFromUrlHints } from './urlUtils.js';
import { hasActiveDimensionRules, hasAnySubstring } from './filters.js';
import { probeDocument } from './probe.js';
import { isFileSchemeAllowed } from './fileAccess.js';
import { REASONS } from './reasons.js';
import { permissionsContains, scriptingExecuteScript } from './chromeApi.js';

/** @typedef {import('./types.js').Settings} Settings */
/** @typedef {import('./types.js').Decision} Decision */
/** @typedef {import('./types.js').ProbeResult} ProbeResult */

/** @param {Object} tab @param {Settings} settings */
export async function decideTab(tab, settings) {
  const url = tab.url || "";
  const canProbe = await canProbeUrl(url);

  const base = decideFromProbe({ url, settings, canProbe, probeResult: null });
  if (base && base.reason !== REASONS.PROBE_NEEDED) return base;

  if (!canProbe) return { shouldDownload: false, reason: REASONS.NO_SITE_ACCESS };

  try {
    const [{ result }] = await scriptingExecuteScript({
      target: { tabId: tab.id },
      func: probeDocument,
      args: [!!settings.strictSingleDetection, Number(settings.coverageThreshold) || 0.5]
    });
    if (!result) return { shouldDownload: false, reason: REASONS.PROBE_FAILED };
    return decideFromProbe({ url, settings, canProbe, probeResult: result });
  } catch {
    return { shouldDownload: false, reason: REASONS.PROBE_FAILED };
  }
}

/** @param {{url: string, settings: Settings, canProbe: boolean, probeResult: ProbeResult|null}} input @returns {Decision} */
export function decideFromProbe({ url, settings, canProbe, probeResult }) {
  const strict = !!settings.strictSingleDetection && canProbe;
  const f = Object.assign({}, settings.filters || {});
  const needDims = !!settings.filtersEnabled && hasActiveDimensionRules(f);

  const ext = extFromUrl(url);
  const allowedExts = Array.isArray(settings.inferUrlAllowedExtensions)
    ? settings.inferUrlAllowedExtensions.map(v => String(v || "").toLowerCase()).filter(Boolean)
    : [...MEDIA_EXTENSION_SET];
  const allowedSet = new Set(allowedExts.filter(Boolean));
  const hintedExt = (settings.inferExtensionFromUrl && allowedSet.size > 0)
    ? inferExtensionFromUrlHints(url, allowedSet)
    : null;
  const triggerMatched = Array.isArray(settings.triggerUrlSubstrings) &&
    hasAnySubstring(url, settings.triggerUrlSubstrings);
  const bypassFilters = !!settings.triggerBypassFilters && triggerMatched;
  const mediaExt = (ext && MEDIA_EXTENSION_SET.has(ext)) ? ext : (hintedExt && MEDIA_EXTENSION_SET.has(hintedExt) ? hintedExt : null);

  const needsProbe = () => ({
    shouldDownload: false,
    reason: canProbe ? REASONS.PROBE_NEEDED : REASONS.NO_SITE_ACCESS
  });

  if (triggerMatched) {
    if (!needDims || bypassFilters) {
      return {
        shouldDownload: true,
        downloadUrl: url,
        suggestedExt: mediaExt || hintedExt || undefined,
        baseName: lastPathSegment(url),
        mimeFromProbe: "",
        bypassFilters,
        triggered: true,
        imageWidth: undefined,
        imageHeight: undefined
      };
    }
    if (!probeResult) return needsProbe();
    return {
      shouldDownload: true,
      downloadUrl: url,
      suggestedExt: mediaExt || hintedExt || undefined,
      baseName: lastPathSegment(url),
      mimeFromProbe: probeResult?.contentType || "",
      bypassFilters,
      triggered: true,
      imageWidth: probeResult?.imageWidth,
      imageHeight: probeResult?.imageHeight
    };
  }

  const chosenExt = mediaExt;
  if (chosenExt) {
    const mime = MEDIA_EXTENSIONS.get(chosenExt) || "";
    if (isMimeIncluded(mime, settings)) {
      if (strict) {
        if (!probeResult) return needsProbe();
        if (probeResult && probeResult.single) {
          const chosen = absolutePrefer(probeResult.src, probeResult.href);
          return {
            shouldDownload: true,
            downloadUrl: chosen,
            suggestedExt: chosenExt,
            baseName: lastPathSegment(chosen) || lastPathSegment(url) || "file",
            mimeFromProbe: probeResult.contentType || mime,
            imageWidth: probeResult.imageWidth,
            imageHeight: probeResult.imageHeight
          };
        }
        return { shouldDownload: false };
      }
      if (!needDims) {
        return {
          shouldDownload: true,
          downloadUrl: url,
          suggestedExt: chosenExt,
          baseName: lastPathSegment(url),
          mimeFromProbe: mime,
          imageWidth: undefined,
          imageHeight: undefined
        };
      }
      if (!probeResult) return needsProbe();
      if (probeResult && (probeResult.single || /^(image)\//i.test(probeResult.contentType))) {
        const chosen = absolutePrefer(probeResult.src, probeResult.href);
        return {
          shouldDownload: true,
          downloadUrl: chosen,
          suggestedExt: chosenExt,
          baseName: lastPathSegment(chosen) || lastPathSegment(url) || "file",
          mimeFromProbe: probeResult.contentType || mime,
          imageWidth: probeResult.imageWidth,
          imageHeight: probeResult.imageHeight
        };
      }
      return {
        shouldDownload: true,
        downloadUrl: url,
        suggestedExt: chosenExt,
        baseName: lastPathSegment(url),
        mimeFromProbe: mime,
        imageWidth: undefined,
        imageHeight: undefined
      };
    }
  }

  if (!probeResult) return needsProbe();

  const { contentType, href, protocol, single, src, looksLikePdf, imageWidth, imageHeight } = probeResult;
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
    const hinted2 = (settings.inferExtensionFromUrl && allowedSet.size > 0)
      ? inferExtensionFromUrlHints(chosen, allowedSet)
      : null;
    const inferExt = extFromUrl(chosen) ||
      hinted2 ||
      (looksLikePdf ? "pdf" : null);
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

  return { shouldDownload: false };
}

async function canProbeUrl(url) {
  try {
    const u = new URL(url || "");
    if (u.protocol === "file:") {
      return await isFileSchemeAllowed();
    }
    if (!["http:", "https:", "ftp:"].includes(u.protocol)) return false;
    const origin = `${u.origin}/*`;
    return await permissionsContains({ origins: [origin] });
  } catch {
    return false;
  }
}
