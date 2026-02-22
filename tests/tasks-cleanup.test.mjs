import assert from "node:assert/strict";
import { createStorageFixture, createChromeBase } from "./helpers/chrome-stubs.mjs";

const TASKS_KEY = "dmtTasks";
const storageFixture = createStorageFixture();
globalThis.chrome = createChromeBase({ storageFixture });

const tasksState = await import("../src/tasksState.js");
const { cleanupTasks, getTasks } = tasksState;

async function setTasks(list) {
  await globalThis.chrome.storage.local.set({ [TASKS_KEY]: list });
}

// 1) Age-based cleanup removes completed/failed only
{
  const now = Date.now();
  await setTasks([
    { id: "a", status: "completed", updatedAt: now - 10 * 60 * 1000 },
    { id: "b", status: "failed", updatedAt: now - 2 * 60 * 1000 },
    { id: "c", status: "pending", updatedAt: now - 100 * 60 * 1000 },
    { id: "d", status: "started", updatedAt: now - 100 * 60 * 1000 }
  ]);

  await cleanupTasks({ maxAgeMin: 5, maxCount: 0 });
  const tasks = await getTasks();
  const ids = new Set(tasks.map(t => t.id));
  assert.equal(ids.has("a"), false);
  assert.equal(ids.has("b"), true);
  assert.equal(ids.has("c"), true);
  assert.equal(ids.has("d"), true);
}

// 2) Max-count cleanup keeps newest completed/failed (FIFO)
{
  const now = Date.now();
  await setTasks([
    { id: "a", status: "completed", updatedAt: now - 1_000 },
    { id: "b", status: "failed", updatedAt: now - 2_000 },
    { id: "c", status: "completed", updatedAt: now - 3_000 },
    { id: "d", status: "completed", updatedAt: now - 4_000 },
    { id: "e", status: "pending", updatedAt: now - 5_000 }
  ]);

  await cleanupTasks({ maxAgeMin: 0, maxCount: 2 });
  const tasks = await getTasks();
  const done = tasks.filter(t => t.status === "completed" || t.status === "failed");
  const doneIds = new Set(done.map(t => t.id));
  assert.equal(done.length, 2);
  assert.equal(doneIds.has("a"), true);
  assert.equal(doneIds.has("b"), true);
  assert.equal(tasks.some(t => t.id === "e"), true);
}

console.log("tasks-cleanup.test.mjs passed");
