import { REASONS } from "./reasons.js";
import { storageLocalGet, storageLocalSet } from "./chromeApi.js";

const TASKS_KEY = "dmtTasks";
const TASKS_MAX = 500;

function now() {
  return Date.now();
}

function normalizeTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks.slice() : [];
  list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (list.length > TASKS_MAX) list.length = TASKS_MAX;
  return list;
}

async function saveTasks(tasks) {
  const list = normalizeTasks(tasks);
  await storageLocalSet({ [TASKS_KEY]: list });
  return list;
}

export async function getTasks() {
  const obj = await storageLocalGet({ [TASKS_KEY]: [] });
  return Array.isArray(obj[TASKS_KEY]) ? obj[TASKS_KEY] : [];
}

export async function getTaskById(id) {
  const tasks = await getTasks();
  return tasks.find(t => t && t.id === id) || null;
}

export async function findTaskByTabUrlKind(tabId, url, kind) {
  const tasks = await getTasks();
  return tasks.find(t =>
    t && t.tabId === tabId && t.url === url && t.kind === (kind || "auto") && t.status !== "completed"
  ) || null;
}

export async function upsertTask({ tabId, url, kind }) {
  const tasks = await getTasks();
  const existing = tasks.find(t =>
    t && t.tabId === tabId && t.url === url && t.kind === (kind || "auto") && t.status !== "completed"
  );
  if (existing) return existing;
  const task = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tabId,
    url,
    kind: kind || "auto",
    status: "pending",
    attempts: 0,
    createdAt: now(),
    updatedAt: now()
  };
  tasks.unshift(task);
  await saveTasks(tasks);
  return task;
}

export async function updateTask(id, patch) {
  if (!id) return null;
  const tasks = await getTasks();
  const idx = tasks.findIndex(t => t && t.id === id);
  if (idx === -1) return null;
  const next = { ...tasks[idx], ...(patch || {}), updatedAt: now() };
  tasks[idx] = next;
  await saveTasks(tasks);
  return next;
}

export async function updateTaskByDownloadId(downloadId, patch) {
  if (typeof downloadId !== "number") return null;
  const tasks = await getTasks();
  const idx = tasks.findIndex(t => t && t.downloadId === downloadId);
  if (idx === -1) return null;
  const next = { ...tasks[idx], ...(patch || {}), updatedAt: now() };
  tasks[idx] = next;
  await saveTasks(tasks);
  return next;
}

export async function clearTasksByStatus(status) {
  const tasks = await getTasks();
  const filtered = tasks.filter(t => t && t.status !== status);
  await saveTasks(filtered);
}

export async function clearAllTasks() {
  await saveTasks([]);
}

export async function removeTask(id) {
  const tasks = await getTasks();
  const filtered = tasks.filter(t => t && t.id !== id);
  await saveTasks(filtered);
}

export async function removeTaskByDownloadId(downloadId) {
  if (typeof downloadId !== "number") return;
  const tasks = await getTasks();
  const filtered = tasks.filter(t => t && t.downloadId !== downloadId);
  if (filtered.length !== tasks.length) {
    await saveTasks(filtered);
  }
}

export async function markTasksForClosedTab(tabId) {
  if (typeof tabId !== "number") return;
  const tasks = await getTasks();
  let changed = false;
  const nowTs = now();
  const next = tasks.map(t => {
    if (!t || t.tabId !== tabId) return t;
    if (t.status !== "pending" && t.status !== "started") return t;
    if (typeof t.downloadId === "number") return t;
    changed = true;
    return { ...t, status: "failed", lastError: REASONS.TAB_CLOSED, updatedAt: nowTs };
  });
  if (changed) await saveTasks(next);
}

export async function cleanupTasks({ maxAgeMin = 0, maxCount = 0 } = {}) {
  const tasks = await getTasks();
  if (!tasks.length) return { removed: 0 };
  const nowTs = Date.now();
  const ageMs = Number(maxAgeMin) > 0 ? Number(maxAgeMin) * 60 * 1000 : 0;
  const limit = Number(maxCount) > 0 ? Number(maxCount) : 0;
  const active = [];
  let done = [];

  for (const t of tasks) {
    if (!t) continue;
    if (t.status === "completed" || t.status === "failed") {
      done.push(t);
    } else {
      active.push(t);
    }
  }

  if (ageMs > 0) {
    done = done.filter(t => {
      const ts = Number(t.updatedAt || t.createdAt || 0);
      return ts >= (nowTs - ageMs);
    });
  }

  if (limit > 0 && done.length > limit) {
    done.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    done = done.slice(0, limit);
  }

  const next = [...active, ...done];
  if (next.length !== tasks.length) await saveTasks(next);
  return { removed: tasks.length - next.length };
}
