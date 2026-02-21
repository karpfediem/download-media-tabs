export function createTraceContext({ mode, candidateCount, now = Date.now() }) {
  const trace = {
    createdAt: now,
    trigger: `manual:${mode || "currentWindow"}`,
    considered: candidateCount,
    entries: []
  };
  return {
    trace,
    traceByTabId: new Map(),
    reasonCounts: new Map()
  };
}

export function recordFilteredTrace(ctx, { tab, reason }) {
  const safeReason = String(reason || "filtered");
  ctx.reasonCounts.set(safeReason, (ctx.reasonCounts.get(safeReason) || 0) + 1);
  const entry = {
    tabId: tab?.id,
    url: tab?.url || "",
    decision: "filtered",
    reason: safeReason
  };
  ctx.trace.entries.push(entry);
  if (typeof entry.tabId === "number") ctx.traceByTabId.set(entry.tabId, entry);
}

export function recordPlannedTrace(ctx, { tab, downloadUrl }) {
  const entry = {
    tabId: tab?.id,
    url: tab?.url || "",
    decision: "download",
    reason: "",
    downloadUrl
  };
  ctx.trace.entries.push(entry);
  if (typeof entry.tabId === "number") ctx.traceByTabId.set(entry.tabId, entry);
}

export function groupEvaluatedResults(evaluated, ctx) {
  const groups = new Map();
  const order = [];
  for (const res of evaluated) {
    if (res.status !== "fulfilled" || !res.value) continue;
    if (!res.value.ok) {
      recordFilteredTrace(ctx, { tab: res.value.tab, reason: res.value.reason });
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
    recordPlannedTrace(ctx, { tab: res.value.tab, downloadUrl: plan.url });
  }
  return { groups, order };
}

export function markTraceDuplicate(ctx, tabId) {
  if (typeof tabId !== "number") return;
  const entry = ctx.traceByTabId.get(tabId);
  if (!entry) return;
  entry.decision = "skipped";
  entry.reason = "duplicate";
}

export function markTraceFailure(ctx, tabId, reason) {
  if (typeof tabId !== "number") return;
  const entry = ctx.traceByTabId.get(tabId);
  if (!entry) return;
  const safeReason = reason || "no-download";
  entry.decision = safeReason === "size-filter" ? "filtered" : "failed";
  entry.reason = safeReason;
}

export function markTraceStarted(ctx, tabId) {
  if (typeof tabId !== "number") return;
  const entry = ctx.traceByTabId.get(tabId);
  if (!entry) return;
  entry.decision = "download";
  entry.reason = "started";
}
