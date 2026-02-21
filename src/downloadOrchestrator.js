import { getSettings } from './settings.js';
import { pLimit } from './concurrency.js';
import { selectCandidateTabs } from './selection.js';
import { buildFilename, hostFromUrl, lastPathSegment, extFromUrl } from './urlUtils.js';
import { DEFAULT_SETTINGS, MEDIA_EXTENSIONS, isMimeIncluded } from './constants.js';
import { applyPreFilters } from './filters.js';
import { sizeWithin, headContentLength } from './headSize.js';
import { decideTab } from './decide.js';
import { setDownloadTabMapping, setPendingSizeConstraint } from './downloadsState.js';
import { upsertTask, updateTask, getTaskById, removeTask } from './tasksState.js';

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

async function evaluateTaskForTab(tab, settings) {
  const decision = await decideTab(tab, settings).catch(() => null);
  if (!decision || !decision.shouldDownload || !decision.downloadUrl) {
    return { ok: false, reason: decision?.reason || "filtered" };
  }
  const plan = planFromDecision(decision, settings, tab.id);
  if (!plan) return { ok: false, reason: "filtered" };
  return { ok: true, plan };
}

async function startDownloadForPlan(plan, settings, batchDate, closeOnStart = false) {
  const filtersOn = !!settings.filtersEnabled;
  const f = Object.assign({}, DEFAULT_SETTINGS.filters, settings.filters || {});
  const hasSizeRule = filtersOn && (f.minBytes > 0 || f.maxBytes > 0);

  if (hasSizeRule && !plan.bypassFilters) {
    try {
      const bytes = await headContentLength(plan.url, 15000);
      if (bytes == null || bytes < 0) {
        plan.postSizeEnforce = true;
      } else if (!sizeWithin(bytes, f.minBytes, f.maxBytes)) {
        return { ok: false, reason: "size-filter" };
      }
    } catch {
      plan.postSizeEnforce = true;
    }
  }

  const downloadId = await startDownloadWithBookkeeping(plan, settings, batchDate, hasSizeRule, f, closeOnStart);
  if (typeof downloadId !== "number") {
    return { ok: false, reason: "no-download" };
  }
  return { ok: true, downloadId };
}

function shouldSkipTask(reason) {
  return reason === "filtered" || reason === "size-filter";
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
  const limitDl = pLimit(Math.max(1, settings.downloadConcurrency | 0));

  const taskEntries = [];
  for (const tab of candidateTabs) {
    const task = await upsertTask({ tabId: tab.id, url: tab.url, kind: "manual" });
    taskEntries.push({ tab, task });
  }

  const evaluated = await Promise.allSettled(taskEntries.map(entry => limitProbe(async () => {
    const attempts = Number(entry.task?.attempts || 0) + 1;
    await updateTask(entry.task.id, { status: "started", attempts, lastAttemptAt: Date.now() });
    const result = await evaluateTaskForTab(entry.tab, settings);
    if (!result.ok) {
      const reason = result.reason || "filtered";
      if (shouldSkipTask(reason)) {
        await removeTask(entry.task.id);
      } else {
        await updateTask(entry.task.id, { status: "failed", lastError: reason });
      }
      return null;
    }
    return { ...entry, plan: result.plan };
  })));

  const seenUrls = new Set();
  const plans = [];
  for (const res of evaluated) {
    if (res.status !== "fulfilled" || !res.value) continue;
    const plan = res.value.plan;
    if (!plan || !plan.url) continue;
    if (seenUrls.has(plan.url)) {
      await updateTask(res.value.task.id, { status: "completed", lastError: "duplicate" });
      continue;
    }
    seenUrls.add(plan.url);
    plans.push(res.value);
  }

  if (!plans.length) {
    console.log("[Download Media Tabs] Nothing to download after filtering.");
    return;
  }

  const results = await Promise.allSettled(plans.map(entry => limitDl(async () => {
    const started = await startDownloadForPlan(entry.plan, settings, batchDate, false);
    if (!started.ok) {
      const reason = started.reason || "no-download";
      if (shouldSkipTask(reason)) {
        await removeTask(entry.task.id);
      } else {
        await updateTask(entry.task.id, { status: "failed", lastError: reason });
      }
      return;
    }
    await updateTask(entry.task.id, { downloadId: started.downloadId });
  })));

  const ok = results.filter(r => r.status === "fulfilled").length;
  const fail = results.length - ok;
  console.log(`[Download Media Tabs] Started ${ok} download(s), ${fail} failed to start.`);
}

// Run a single task (used by auto-run and retries)
export async function runTaskForTab(tabOrId, taskId, opts = {}) {
  const settings = await getSettings();
  const closeOnStart = !!opts.closeOnStart;
  const retryOnComplete = !!opts.retryOnComplete;

  // Attempt to acquire optional host permissions as per user whitelist (autorun path)
  try { await ensureHostPermissionsFromWhitelist(settings); } catch {}
  let tab = tabOrId;
  if (typeof tabOrId === 'number') {
    try { tab = await chrome.tabs.get(tabOrId); } catch { return; }
  }
  if (!tab || !tab.url) {
    if (taskId) await updateTask(taskId, { status: "failed", lastError: "no-tab" });
    return;
  }
  try {
    const u = new URL(tab.url);
    if (!["http:", "https:", "file:", "ftp:", "data:"].includes(u.protocol)) return;
  } catch { return; }

  if (taskId) {
    const existing = await getTaskById(taskId);
    const attempts = Number(existing?.attempts || 0) + 1;
    await updateTask(taskId, { status: "started", attempts, lastAttemptAt: Date.now() });
  }

  const result = await evaluateTaskForTab(tab, settings);
  if (!result.ok) {
    if (taskId) {
      const reason = result.reason || "filtered";
      if (shouldSkipTask(reason)) {
        await removeTask(taskId);
      } else {
        await updateTask(taskId, {
          status: retryOnComplete ? "pending" : "failed",
          lastError: retryOnComplete ? "no-download" : reason
        });
      }
    }
    return;
  }

  const batchDate = new Date();
  const started = await startDownloadForPlan(result.plan, settings, batchDate, closeOnStart);
  if (!started.ok) {
    if (taskId) {
      const reason = started.reason || "no-download";
      if (shouldSkipTask(reason)) {
        await removeTask(taskId);
      } else {
        await updateTask(taskId, {
          status: retryOnComplete ? "pending" : "failed",
          lastError: retryOnComplete ? "no-download" : reason
        });
      }
    }
    return;
  }
  if (taskId) {
    await updateTask(taskId, { downloadId: started.downloadId });
  }
  console.log("[Download Media Tabs] Started 1 download (auto-run)");
  return started.downloadId;
}
