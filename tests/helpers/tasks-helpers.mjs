import { upsertTask, updateTask } from "../../src/tasksState.js";

const TASKS_KEY = "dmtTasks";

export async function resetTasksStorage() {
  try {
    if (globalThis.chrome?.storage?.local?.set) {
      await globalThis.chrome.storage.local.set({ [TASKS_KEY]: [] });
    }
  } catch {}
}

export async function createTaskWithDownloadId({
  tabId,
  url,
  downloadId,
  kind = "manual",
  status = "started"
}) {
  const task = await upsertTask({ tabId, url, kind });
  await updateTask(task.id, { downloadId, status });
  return task;
}
