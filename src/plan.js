import { DEFAULT_SETTINGS, MEDIA_EXTENSIONS, isMimeIncluded } from './constants.js';
import { applyPreFilters } from './filters.js';
import { extFromUrl, hostFromUrl } from './urlUtils.js';

export function planFromDecision(decision, settings, tabId) {
  if (!decision || !decision.shouldDownload || !decision.downloadUrl) return null;
  const ext = (decision.suggestedExt || extFromUrl(decision.downloadUrl) || 'bin').toLowerCase();
  const host = hostFromUrl(decision.downloadUrl);
  const mime = (decision.mimeFromProbe && String(decision.mimeFromProbe).toLowerCase()) ||
    MEDIA_EXTENSIONS.get(ext) || '';

  if (!decision.bypassFilters && !decision.triggered) {
    if (!isMimeIncluded(mime || (MEDIA_EXTENSIONS.get(ext) || ''), settings)) return null;
  }

  const filtersOn = !!settings.filtersEnabled;
  const f = Object.assign({}, DEFAULT_SETTINGS.filters, settings.filters || {});

  if (filtersOn && !decision.bypassFilters) {
    const preVerdict = applyPreFilters({
      url: decision.downloadUrl,
      host,
      ext,
      mime,
      width: decision.imageWidth,
      height: decision.imageHeight
    }, f);
    if (!preVerdict.pass) return null;
  }

  return {
    tabId,
    url: decision.downloadUrl,
    host,
    ext,
    mime,
    bypassFilters: !!decision.bypassFilters,
    triggered: !!decision.triggered,
    baseName: decision.baseName,
    width: decision.imageWidth,
    height: decision.imageHeight
  };
}
