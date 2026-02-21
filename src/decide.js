import { MEDIA_EXTENSION_SET, MEDIA_EXTENSIONS, isMimeIncluded, extensionSuggestForMime } from './constants.js';
import { extFromUrl, lastPathSegment, absolutePrefer, inferExtensionFromUrlHints } from './urlUtils.js';
import { hasActiveDimensionRules, hasAnySubstring } from './filters.js';
import { probeDocument } from './probe.js';

export async function decideTab(tab, settings) {
  const url = tab.url || "";

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
    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: probeDocument,
        args: [!!settings.strictSingleDetection, Number(settings.coverageThreshold) || 0.5]
      });
      return {
        shouldDownload: true,
        downloadUrl: url,
        suggestedExt: mediaExt || hintedExt || undefined,
        baseName: lastPathSegment(url),
        mimeFromProbe: result?.contentType || "",
        bypassFilters,
        triggered: true,
        imageWidth: result?.imageWidth,
        imageHeight: result?.imageHeight
      };
    } catch {
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
  }

  const chosenExt = mediaExt;
  if (chosenExt) {
    const mime = MEDIA_EXTENSIONS.get(chosenExt) || "";
    if (isMimeIncluded(mime, settings)) {
      if (settings.strictSingleDetection) {
        try {
          const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: probeDocument,
            args: [!!settings.strictSingleDetection, Number(settings.coverageThreshold) || 0.5]
          });
          if (result && result.single) {
            const chosen = absolutePrefer(result.src, result.href);
            return {
              shouldDownload: true,
              downloadUrl: chosen,
              suggestedExt: chosenExt,
              baseName: lastPathSegment(chosen) || lastPathSegment(url) || "file",
              mimeFromProbe: result.contentType || mime,
              imageWidth: result.imageWidth,
              imageHeight: result.imageHeight
            };
          }
          return { shouldDownload: false };
        } catch {
          return { shouldDownload: false };
        }
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
            suggestedExt: chosenExt,
            baseName: lastPathSegment(chosen) || lastPathSegment(url) || "file",
            mimeFromProbe: result.contentType || mime,
            imageWidth: result.imageWidth,
            imageHeight: result.imageHeight
          };
        }
      } catch {}
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
  } catch {}

  return { shouldDownload: false };
}
