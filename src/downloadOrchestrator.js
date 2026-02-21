import { getSettings } from './settings.js';
import { pLimit } from './concurrency.js';
import { selectCandidateTabs } from './selection.js';
import { buildFilename, lastPathSegment } from './urlUtils.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { sizeWithin, headContentLength } from './headSize.js';
import { setDownloadTabMapping, setPendingSizeConstraint } from './downloadsState.js';
import { upsertTask, updateTask, getTaskById, removeTask } from './tasksState.js';
import { isFileSchemeAllowed } from './fileAccess.js';
import { markDuplicatesByUrl } from './taskUtils.js';
import { evaluateTabForPlan, createTaskEntriesFromEvaluated } from './taskPipeline.js';

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

async function saveRunTrace(trace) {
  try {
    if (chrome.storage?.local) {
      await chrome.storage.local.set({ dmtLastRunTrace: trace });
    }
  } catch {}
}

export async function runDownload({ mode }) {
  const settings = await getSettings();

  // Attempt to acquire optional host permissions as per user whitelist
  try { await ensureHostPermissionsFromWhitelist(settings); } catch {}

  const allTabs = await selectCandidateTabs(mode || "currentWindow");
  const fileAccessAllowed = await isFileSchemeAllowed();

  const candidateTabs = allTabs.filter(t => {
    try {
      const u = new URL(t.url || "");
      if (u.protocol === "file:") return fileAccessAllowed;
      return ["http:", "https:", "ftp:", "data:"].includes(u.protocol);
    } catch { return false; }
  });
  const trace = {
    createdAt: Date.now(),
    trigger: `manual:${mode || "currentWindow"}`,
    considered: candidateTabs.length,
    entries: []
  };
  const traceByTabId = new Map();
  if (candidateTabs.length === 0) {
    console.log("[Download Media Tabs] No candidate tabs.");
    trace.note = "No candidate tabs (only non-web URLs in scope).";
    await saveRunTrace(trace);
    return;
  }

  const batchDate = new Date();
  const limitProbe = pLimit(Math.max(1, settings.probeConcurrency | 0));
  const limitDl = pLimit(Math.max(1, settings.downloadConcurrency | 0));

  const evaluated = await Promise.allSettled(candidateTabs.map(tab => limitProbe(async () => {
    return await evaluateTabForPlan(tab, settings);
  })));

  const reasonCounts = new Map();
  const groups = new Map();
  const order = [];
  for (const res of evaluated) {
    if (res.status !== "fulfilled" || !res.value) continue;
    if (!res.value.ok) {
      const reason = String(res.value.reason || "filtered");
      reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
      const entry = {
        tabId: res.value.tab?.id,
        url: res.value.tab?.url || "",
        decision: "filtered",
        reason
      };
      trace.entries.push(entry);
      if (typeof entry.tabId === "number") traceByTabId.set(entry.tabId, entry);
      continue;
    }
    const plan = res.value.plan;
    if (!plan || !plan.url) continue;
    const key = plan.url;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push({ tab: res.value.tab, plan });
    const entry = {
      tabId: res.value.tab?.id,
      url: res.value.tab?.url || "",
      decision: "download",
      reason: "",
      downloadUrl: plan.url
    };
    trace.entries.push(entry);
    if (typeof entry.tabId === "number") traceByTabId.set(entry.tabId, entry);
  }

  if (!order.length) {
    console.log("[Download Media Tabs] Nothing to download after filtering.");
    if (reasonCounts.has("no-site-access")) {
      console.warn("[Download Media Tabs] Probe blocked by missing site access. Grant site access (chrome://extensions or Performance → Request permissions) or disable strict detection.");
    } else if (reasonCounts.has("probe-failed")) {
      console.warn("[Download Media Tabs] Probe failed. Try reloading the tab or disabling strict detection.");
    }
    trace.note = "No downloads started (all URLs filtered).";
    await saveRunTrace(trace);
    return;
  }

  const taskEntries = [];
  for (const key of order) {
    const group = groups.get(key) || [];
    const created = await createTaskEntriesFromEvaluated(
      group.map(entry => ({ ...entry, ok: true })),
      upsertTask,
      "manual"
    );
    for (const entry of created) {
      taskEntries.push({ ...entry, isDuplicate: false, groupKey: key });
    }
  }

  const markedEntries = markDuplicatesByUrl(taskEntries, (e) => e?.plan?.url);
  for (const entry of markedEntries) {
    if (entry.isDuplicate) {
      await updateTask(entry.task.id, { status: "completed", lastError: "duplicate" });
      const traceEntry = traceByTabId.get(entry.tab?.id);
      if (traceEntry) {
        traceEntry.decision = "skipped";
        traceEntry.reason = "duplicate";
      }
    }
  }

  const results = await Promise.allSettled(markedEntries.filter(e => !e.isDuplicate).map(entry => limitDl(async () => {
    const started = await startDownloadForPlan(entry.plan, settings, batchDate, false);
    if (!started.ok) {
      const reason = started.reason || "no-download";
      if (shouldSkipTask(reason)) {
        await removeTask(entry.task.id);
      } else {
        await updateTask(entry.task.id, { status: "failed", lastError: reason });
      }
      const traceEntry = traceByTabId.get(entry.tab?.id);
      if (traceEntry) {
        if (reason === "size-filter") {
          traceEntry.decision = "filtered";
        } else {
          traceEntry.decision = "failed";
        }
        traceEntry.reason = reason;
      }
      return;
    }
    await updateTask(entry.task.id, { downloadId: started.downloadId });
    const traceEntry = traceByTabId.get(entry.tab?.id);
    if (traceEntry) {
      traceEntry.decision = "download";
      traceEntry.reason = "started";
    }
  })));

  const ok = results.filter(r => r.status === "fulfilled").length;
  const fail = results.length - ok;
  console.log(`[Download Media Tabs] Started ${ok} download(s), ${fail} failed to start.`);
  await saveRunTrace(trace);
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
    if (u.protocol === "file:") {
      const allowed = await isFileSchemeAllowed();
      if (!allowed) return;
    } else if (!["http:", "https:", "ftp:", "data:"].includes(u.protocol)) {
      return;
    }
  } catch { return; }

  if (taskId) {
    const existing = await getTaskById(taskId);
    const attempts = Number(existing?.attempts || 0) + 1;
    await updateTask(taskId, { status: "started", attempts, lastAttemptAt: Date.now() });
  }

  const result = await evaluateTabForPlan(tab, settings);
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
