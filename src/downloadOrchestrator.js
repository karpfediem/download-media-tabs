import { getSettings } from './settings.js';
import { pLimit } from './concurrency.js';
import { selectCandidateTabs } from './selection.js';
import { buildFilename, lastPathSegment } from './urlUtils.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { sizeWithin, headContentLength } from './headSize.js';
import { setDownloadTabMapping, setPendingSizeConstraint } from './downloadsState.js';
import { closeTabRespectingWindow } from './closeTab.js';
import { upsertTask, updateTask, getTaskById, removeTask } from './tasksState.js';
import { isFileSchemeAllowed } from './fileAccess.js';
import { markDuplicatesByUrl } from './taskUtils.js';
import { evaluateTabForPlan, createTaskEntriesFromEvaluated } from './taskPipeline.js';
import {
  createTraceContext,
  groupEvaluatedResults,
  markTraceDuplicate,
  markTraceFailure,
  markTraceStarted
} from './orchestratorUtils.js';
import { REASONS } from './reasons.js';
import {
  downloadsDownload,
  permissionsContains,
  tabsGet,
  storageLocalSet
} from './chromeApi.js';
import { failureUpdate } from './taskStatus.js';

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
  const downloadId = await downloadsDownload({
    url: p.url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify'
  });

  if (typeof downloadId === 'number') {
    if (p.tabId != null) await setDownloadTabMapping(downloadId, p.tabId, p.tabUrl || "", p.url, closeOnStart);
    if (hasSizeRule && !p.bypassFilters && p.postSizeEnforce) {
      await setPendingSizeConstraint(downloadId, { minBytes: f.minBytes, maxBytes: f.maxBytes });
    }
  }
  return downloadId;
}

async function hasHostPermissionsForWhitelist(settings) {
  try {
    const patterns = Array.isArray(settings.allowedOrigins) ? settings.allowedOrigins.filter(Boolean) : [];
    if (!patterns.length) return false;
    return await permissionsContains({ origins: patterns });
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
        return { ok: false, reason: REASONS.SIZE_FILTER };
      }
    } catch {
      plan.postSizeEnforce = true;
    }
  }

  const downloadId = await startDownloadWithBookkeeping(plan, settings, batchDate, hasSizeRule, f, closeOnStart);
  if (typeof downloadId !== "number") {
    return { ok: false, reason: REASONS.NO_DOWNLOAD };
  }
  return { ok: true, downloadId };
}

async function finalizeTaskFailure(taskId, reason, { retryOnComplete = false } = {}) {
  if (!taskId) return;
  const action = failureUpdate(reason, { retryOnComplete });
  if (action.action === "remove") {
    await removeTask(taskId);
    return;
  }
  await updateTask(taskId, { status: action.status, lastError: action.lastError });
}

async function saveRunTrace(trace) {
  try {
    await storageLocalSet({ dmtLastRunTrace: trace });
  } catch {}
}

export async function runDownload({ mode }) {
  const settings = await getSettings();
  const closeOnStart = !!settings.autoCloseOnStart;

  // Check optional host permissions as per user whitelist
  try { await hasHostPermissionsForWhitelist(settings); } catch {}

  const allTabs = await selectCandidateTabs(mode || "currentWindow");
  const fileAccessAllowed = await isFileSchemeAllowed();

  const candidateTabs = allTabs.filter(t => {
    try {
      const u = new URL(t.url || "");
      if (u.protocol === "file:") return fileAccessAllowed;
      return ["http:", "https:", "ftp:", "data:"].includes(u.protocol);
    } catch { return false; }
  });
  const traceCtx = createTraceContext({
    mode: mode || "currentWindow",
    candidateCount: candidateTabs.length,
    now: Date.now()
  });
  if (candidateTabs.length === 0) {
    console.log("[Download Media Tabs] No candidate tabs.");
    traceCtx.trace.note = "No candidate tabs (only non-web URLs in scope).";
    await saveRunTrace(traceCtx.trace);
    return;
  }

  const batchDate = new Date();
  const limitProbe = pLimit(Math.max(1, settings.probeConcurrency | 0));
  const limitDl = pLimit(Math.max(1, settings.downloadConcurrency | 0));

  const evaluated = await Promise.allSettled(candidateTabs.map(tab => limitProbe(async () => {
    return await evaluateTabForPlan(tab, settings);
  })));

  const { groups, order } = groupEvaluatedResults(evaluated, traceCtx);

  if (!order.length) {
    console.log("[Download Media Tabs] Nothing to download after filtering.");
    if (traceCtx.reasonCounts.has(REASONS.NO_SITE_ACCESS)) {
      console.warn("[Download Media Tabs] Probe blocked by missing site access. Grant site access (chrome://extensions or Performance → Request permissions) or disable strict detection.");
    } else if (traceCtx.reasonCounts.has(REASONS.PROBE_FAILED)) {
      console.warn("[Download Media Tabs] Probe failed. Try reloading the tab or disabling strict detection.");
    }
    traceCtx.trace.note = "No downloads started (all URLs filtered).";
    await saveRunTrace(traceCtx.trace);
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
      await updateTask(entry.task.id, { status: "completed", lastError: REASONS.DUPLICATE });
      markTraceDuplicate(traceCtx, entry.tab?.id);
      if ((settings.autoCloseOnStart || settings.closeTabAfterDownload) && typeof entry.tab?.id === "number") {
        try {
          const tab = await tabsGet(entry.tab.id);
          if (!tab || tab.url !== entry.tab.url) continue;
          await closeTabRespectingWindow(entry.tab.id, settings);
        } catch {}
      }
    }
  }

  const results = await Promise.allSettled(markedEntries.filter(e => !e.isDuplicate).map(entry => limitDl(async () => {
    const started = await startDownloadForPlan(entry.plan, settings, batchDate, closeOnStart);
    if (!started.ok) {
      const reason = started.reason || REASONS.NO_DOWNLOAD;
      await finalizeTaskFailure(entry.task.id, reason);
      markTraceFailure(traceCtx, entry.tab?.id, reason);
      return;
    }
    await updateTask(entry.task.id, { downloadId: started.downloadId });
    markTraceStarted(traceCtx, entry.tab?.id);
  })));

  const ok = results.filter(r => r.status === "fulfilled").length;
  const fail = results.length - ok;
  console.log(`[Download Media Tabs] Started ${ok} download(s), ${fail} failed to start.`);
  await saveRunTrace(traceCtx.trace);
}

// Run a single task (used by auto-run and retries)
export async function runTaskForTab(tabOrId, taskId, opts = {}) {
  const settings = await getSettings();
  const closeOnStart = !!opts.closeOnStart;
  const retryOnComplete = !!opts.retryOnComplete;

  // Check optional host permissions as per user whitelist (autorun path)
  try { await hasHostPermissionsForWhitelist(settings); } catch {}
  let tab = tabOrId;
  if (typeof tabOrId === 'number') {
    try { tab = await tabsGet(tabOrId); } catch { return; }
  }
  if (!tab || !tab.url) {
    if (taskId) await updateTask(taskId, { status: "failed", lastError: REASONS.NO_TAB });
    return;
  }
  try {
    const u = new URL(tab.url);
    if (u.protocol === "file:") {
      const allowed = await isFileSchemeAllowed();
      if (!allowed) {
        if (taskId) await finalizeTaskFailure(taskId, REASONS.NO_SITE_ACCESS, { retryOnComplete });
        return;
      }
    } else if (!["http:", "https:", "ftp:", "data:"].includes(u.protocol)) {
      if (taskId) await finalizeTaskFailure(taskId, REASONS.FILTERED, { retryOnComplete });
      return;
    }
  } catch {
    if (taskId) await finalizeTaskFailure(taskId, REASONS.FILTERED, { retryOnComplete });
    return;
  }

  if (taskId) {
    const existing = await getTaskById(taskId);
    const attempts = Number(existing?.attempts || 0) + 1;
    await updateTask(taskId, { status: "started", attempts, lastAttemptAt: Date.now() });
  }

  const result = await evaluateTabForPlan(tab, settings);
  if (!result.ok) {
    if (taskId) {
      const reason = result.reason || REASONS.FILTERED;
      await finalizeTaskFailure(taskId, reason, { retryOnComplete });
    }
    return;
  }

  const batchDate = new Date();
  const started = await startDownloadForPlan(result.plan, settings, batchDate, closeOnStart);
  if (!started.ok) {
    if (taskId) {
      const reason = started.reason || REASONS.NO_DOWNLOAD;
      await finalizeTaskFailure(taskId, reason, { retryOnComplete });
    }
    return;
  }
  if (taskId) {
    await updateTask(taskId, { downloadId: started.downloadId });
  }
  console.log("[Download Media Tabs] Started 1 download (auto-run)");
  return started.downloadId;
}
