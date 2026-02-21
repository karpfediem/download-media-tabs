import { getSettings } from './settings.js';
import { pLimit } from './concurrency.js';
import { selectCandidateTabs } from './selection.js';
import { buildFilename, hostFromUrl, lastPathSegment, extFromUrl } from './urlUtils.js';
import { DEFAULT_SETTINGS, MEDIA_EXTENSIONS, isMimeIncluded } from './constants.js';
import { applyPreFilters } from './filters.js';
import { sizeWithin, headContentLength } from './headSize.js';
import { decideTab } from './decide.js';
import { setDownloadTabMapping, setPendingSizeConstraint, pendingSizeConstraints } from './downloadsState.js';
import { upsertTask, updateTask, getTaskById } from './tasksState.js';

// Internal helpers to reduce duplication and keep behavior consistent
function planFromDecision(decision, settings, tabId) {
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

async function startDownloadWithBookkeeping(p, settings, batchDate, hasSizeRule, f, closeOnStart = false) {
  if (p.taskId) {
    const existing = await getTaskById(p.taskId);
    const attempts = Number(existing?.attempts || 0) + 1;
    await updateTask(p.taskId, { status: "started", attempts, lastAttemptAt: Date.now() });
  }
  const filename = buildFilename(settings.filenamePattern, {
    date: batchDate,
    host: p.host,
    basename: p.baseName || (lastPathSegment(p.url) || 'file'),
    ext: p.ext
  });
  console.log("[Download Media Tabs] download plan", {
    url: p.url,
    host: p.host,
    baseName: p.baseName,
    ext: p.ext,
    filename,
    bypassFilters: !!p.bypassFilters,
    triggered: !!p.triggered
  });
  const downloadId = await chrome.downloads.download({
    url: p.url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify'
  }).catch(() => null);

  if (typeof downloadId === 'number') {
    if (p.tabId != null) await setDownloadTabMapping(downloadId, p.tabId, p.url, closeOnStart);
    if (hasSizeRule && !p.bypassFilters && p.postSizeEnforce) {
      await setPendingSizeConstraint(downloadId, { minBytes: f.minBytes, maxBytes: f.maxBytes });
    }
    if (p.taskId) {
      await updateTask(p.taskId, { downloadId });
    }
  } else if (p.taskId) {
    await updateTask(p.taskId, { status: "failed", lastError: "no-download" });
  }
  return downloadId;
}

async function ensureHostPermissionsFromWhitelist(settings) {
  try {
    const patterns = Array.isArray(settings.allowedOrigins) ? settings.allowedOrigins.filter(Boolean) : [];
    if (!patterns.length) return false;
    const ok = await new Promise(resolve => {
      chrome.permissions.contains({ origins: patterns }, resolve);
    });
    return !!ok;
  } catch {
    return false;
  }
}

export async function runDownload({ mode }) {
  const settings = await getSettings();

  // Attempt to acquire optional host permissions as per user whitelist
  try { await ensureHostPermissionsFromWhitelist(settings); } catch {}

  const allTabs = await selectCandidateTabs(mode || "currentWindow");

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

  const limitProbe = pLimit(Math.max(1, settings.probeConcurrency | 0));
  const decisions = await Promise.allSettled(
    candidateTabs.map(tab => limitProbe(() => decideTab(tab, settings)))
  );

  const seenUrl = new Map();
  const plans = [];

  const filtersOn = !!settings.filtersEnabled;
  const f = Object.assign({}, DEFAULT_SETTINGS.filters, settings.filters || {});
  const hasSizeRule = filtersOn && (f.minBytes > 0 || f.maxBytes > 0);

  let probeFailed = 0;
  let probeBlocked = 0;
  for (let i = 0; i < decisions.length; i++) {
    const res = decisions[i];
    if (res.status !== "fulfilled" || !res.value || !res.value.shouldDownload) {
      if (res.status === "fulfilled" && res.value && res.value.reason === "probe-failed") {
        probeFailed += 1;
      }
      if (res.status === "fulfilled" && res.value && res.value.reason === "no-site-access") {
        probeBlocked += 1;
      }
      continue;
    }

    const tab = candidateTabs[i];
    const { downloadUrl, suggestedExt, baseName, mimeFromProbe, imageWidth, imageHeight } = res.value;
    if (!downloadUrl) continue;
    if (seenUrl.has(downloadUrl)) continue;
    seenUrl.set(downloadUrl, tab.id);

    const plan = planFromDecision(res.value, settings, tab.id);
    if (plan) plans.push(plan);
  }

  if (!plans.length) {
    console.log("[Download Media Tabs] Nothing to download after filtering.");
    if (probeBlocked > 0) {
      console.warn("[Download Media Tabs] Probe blocked by missing site access. Grant site access (chrome://extensions or Performance → Request permissions) or disable strict detection.");
    } else if (probeFailed > 0) {
      console.warn("[Download Media Tabs] Probe failed. Try reloading the tab or disabling strict detection.");
    }
    return;
  }

  if (hasSizeRule) {
    const limitHead = pLimit(Math.max(1, settings.probeConcurrency | 0));
    const headResults = await Promise.allSettled(plans.map(p => limitHead(async () => {
      if (p.bypassFilters) return { known: false, ok: true, bypass: true };
      const bytes = await headContentLength(p.url, 15000);
      if (bytes == null || bytes < 0) return { known: false, ok: true };
      const ok = sizeWithin(bytes, f.minBytes, f.maxBytes);
      return { known: true, ok, bytes };
    })));

    const filtered = [];
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i];
      const r = headResults[i];
      if (r.status !== "fulfilled") {
        if (!plan.bypassFilters) plan.postSizeEnforce = true;
        filtered.push(plan);
        continue;
      }
      const { known, ok } = r.value;
      if (known) {
        if (!ok) continue;
        filtered.push(plan);
      } else {
        if (!plan.bypassFilters) plan.postSizeEnforce = true;
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

  for (const plan of plans) {
    const task = await upsertTask({ tabId: plan.tabId, url: plan.url, kind: "manual" });
    plan.taskId = task?.id;
  }

  const limitDl = pLimit(Math.max(1, settings.downloadConcurrency | 0));
  const results = await Promise.allSettled(plans.map(p => limitDl(async () => {
    await startDownloadWithBookkeeping(p, settings, batchDate, hasSizeRule, f);
  })));

  const ok = results.filter(r => r.status === "fulfilled").length;
  const fail = results.length - ok;
  console.log(`[Download Media Tabs] Started ${ok} download(s), ${fail} failed to start.`);
}

// Run for a single tab (used by auto-run on new tabs)
export async function runDownloadForTab(tabOrId, opts = {}) {
  const settings = await getSettings();
  const closeOnStart = !!opts.closeOnStart;

  // Attempt to acquire optional host permissions as per user whitelist (autorun path)
  try { await ensureHostPermissionsFromWhitelist(settings); } catch {}
  let tab = tabOrId;
  if (typeof tabOrId === 'number') {
    try { tab = await chrome.tabs.get(tabOrId); } catch { return; }
  }
  if (!tab || !tab.url) return;
  try {
    const u = new URL(tab.url);
    if (!["http:", "https:", "file:", "ftp:", "data:"].includes(u.protocol)) return;
  } catch { return; }

  const decision = await decideTab(tab, settings).catch(() => null);
  if (!decision || !decision.shouldDownload || !decision.downloadUrl) return;

  const batchDate = new Date();

  const filtersOn = !!settings.filtersEnabled;
  const f = Object.assign({}, DEFAULT_SETTINGS.filters, settings.filters || {});
  const hasSizeRule = filtersOn && (f.minBytes > 0 || f.maxBytes > 0);

  const plan = planFromDecision(decision, settings, tab.id);
  if (!plan) return;

  // Optional HEAD size check
  if (hasSizeRule && !plan.bypassFilters) {
    try {
      const bytes = await headContentLength(plan.url, 15000);
      if (bytes == null || bytes < 0) {
        plan.postSizeEnforce = true;
      } else if (!sizeWithin(bytes, f.minBytes, f.maxBytes)) {
        return; // out of size bounds
      }
    } catch {
      plan.postSizeEnforce = true;
    }
  }

  const downloadId = await startDownloadWithBookkeeping(plan, settings, batchDate, hasSizeRule, f, closeOnStart);

  if (typeof downloadId === 'number') {
    console.log("[Download Media Tabs] Started 1 download (auto-run)");
  }
  return downloadId;
}
