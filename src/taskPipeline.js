import { decideTab } from "./decide.js";
import { planFromDecision } from "./plan.js";

export async function evaluateTabForPlan(tab, settings, decideFn = decideTab) {
  let decision = null;
  try { decision = await decideFn(tab, settings); } catch { decision = null; }
  if (!decision || !decision.shouldDownload || !decision.downloadUrl) {
    return { tab, ok: false, reason: decision?.reason || "filtered" };
  }
  const plan = planFromDecision(decision, settings, tab?.id);
  if (!plan) return { tab, ok: false, reason: "filtered" };
  const withTabUrl = tab?.url ? { ...plan, tabUrl: tab.url } : plan;
  return { tab, ok: true, plan: withTabUrl };
}

export async function createTaskEntriesFromEvaluated(evaluated, createTask, kind = "manual") {
  const entries = [];
  for (const item of evaluated) {
    if (!item || !item.ok) continue;
    const task = await createTask({ tabId: item.tab?.id, url: item.tab?.url, kind });
    entries.push({ ...item, task });
  }
  return entries;
}
