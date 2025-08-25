import { MEDIA_EXTENSION_SET, MEDIA_EXTENSIONS, isMimeIncluded, extensionSuggestForMime } from './constants.js';
import { extFromUrl, lastPathSegment, absolutePrefer } from './urlUtils.js';
import { hasActiveDimensionRules } from './filters.js';
import { probeDocument } from './probe.js';

export async function decideTab(tab, settings) {
  const url = tab.url || "";

  const f = Object.assign({}, settings.filters || {});
  const needDims = !!settings.filtersEnabled && hasActiveDimensionRules(f);

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
      } catch {}
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
  } catch {}

  return { shouldDownload: false };
}
